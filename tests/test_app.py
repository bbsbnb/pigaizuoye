import io
import os
import tempfile
import subprocess
import sys
import json
from pathlib import Path
import unittest
from unittest.mock import patch

os.environ['DATA_DIR'] = tempfile.mkdtemp(prefix='homework-test-')
from PIL import Image
from app import app, stats, get, dates, put, compose_report


class WorkflowTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.client = app.test_client()
        cls.csrf = cls.client.get('/api/state').json['csrf']

    def post(self, url, body):
        return self.client.post('/api/' + url, json=body, headers={'X-CSRF-Token': self.csrf})

    def student(self):
        return self.post('students', {'name': '测试学生'}).json['id']

    def upload(self, sid, parent='', selected=None):
        stream = io.BytesIO()
        Image.new('RGB', (60, 60), 'white').save(stream, 'PNG')
        stream.seek(0)
        import json
        return self.client.post('/api/upload', data={'student': sid, 'subject': '数学', 'date': '2026-10-23',
            'parent': parent, 'selected': json.dumps(selected or []), 'photos': (stream, 'test.png')}, headers={'X-CSRF-Token': self.csrf})

    def question(self, **kw):
        return dict(id='q1', kind='objective', verdict='wrong', label='1', text='2+3', answer='6',
                    explanation='加法错误', reference='5', knowledge='加法', **kw)

    def test_passwordless_access_and_csrf(self):
        anonymous = app.test_client()
        response = anonymous.get('/api/state')
        self.assertEqual(response.status_code, 200)
        self.assertIn('students', response.json)
        self.assertIn('batches', response.json)
        self.assertEqual(anonymous.post('/api/students', json={'name': '无令牌'}).status_code, 403)
        self.assertEqual(anonymous.post('/api/students', json={'name': '免密码测试'},
                         headers={'X-CSRF-Token': response.json['csrf']}).status_code, 200)
        self.assertEqual(self.client.post('/api/students', json={'name': '无令牌'}).status_code, 403)

    def test_remote_access_rejected(self):
        for path in ('/', '/api/state', '/photo/anything.jpg', '/static/app.js'):
            with self.subTest(path=path):
                self.assertEqual(app.test_client().get(path, environ_overrides={'REMOTE_ADDR': '192.168.1.20'}).status_code, 403)

    def test_model_configuration(self):
        with tempfile.TemporaryDirectory() as folder, patch('app.DATA', Path(folder)), patch.dict(os.environ, {}, clear=True):
            body = dict(baseUrl='https://example.com/v1/', model='vision-test', apiKey='secret-test-key', privacyReviewed=False)
            response = self.post('model-config', body)
            self.assertEqual(response.status_code, 200)
            self.assertNotIn('secret-test-key', response.get_data(as_text=True))
            self.assertTrue(response.json['hasKey'])
            self.assertFalse(self.client.get('/api/state').json['aiReady'])
            body.update(apiKey='', privacyReviewed=True)
            self.assertEqual(self.post('model-config', body).status_code, 200)
            saved = json.loads((Path(folder) / 'model-config.json').read_text(encoding='utf-8'))
            self.assertEqual(saved['AI_API_KEY'], 'secret-test-key')
            self.assertTrue(self.client.get('/api/state').json['aiReady'])
            self.assertNotIn('secret-test-key', self.client.get('/api/model-config').get_data(as_text=True))
            self.assertEqual(self.post('model-config', dict(body, baseUrl='http://example.com')).status_code, 400)
            self.assertFalse(self.post('model-config', dict(body, clearKey=True)).json['hasKey'])
            with patch.dict(os.environ, {'AI_MODEL': 'managed-model'}):
                self.assertEqual(self.post('model-config', body).json['model'], 'vision-test')
                self.assertEqual(self.client.get('/api/model-config').json['managed'], [])
            self.assertEqual(self.client.post('/api/model-config', json=body).status_code, 403)

    def test_web_settings_override_environment_defaults(self):
        defaults = dict(AI_BASE_URL='https://default.example/v1', AI_MODEL='default-model',
                        AI_API_KEY='environment-secret', AI_PRIVACY_REVIEWED='yes')
        with tempfile.TemporaryDirectory() as folder, patch('app.DATA', Path(folder)), patch.dict(os.environ, defaults):
            initial = self.client.get('/api/model-config').json
            self.assertEqual(initial['model'], 'default-model')
            self.assertTrue(initial['hasKey'])
            body = dict(baseUrl='https://updated.example/v1', model='updated-model', apiKey='', privacyReviewed=False)
            response = self.post('model-config', body)
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.json['baseUrl'], body['baseUrl'])
            self.assertEqual(response.json['model'], body['model'])
            self.assertTrue(response.json['hasKey'])
            self.assertFalse(response.json['privacyReviewed'])
            self.assertFalse(self.client.get('/api/state').json['aiReady'])
            self.assertNotIn('environment-secret', response.get_data(as_text=True))
            self.assertFalse(self.post('model-config', dict(body, clearKey=True)).json['hasKey'])
            self.assertFalse(self.client.get('/api/model-config').json['hasKey'])

    def test_records_survive_new_process_until_explicit_delete(self):
        sid = self.student()
        batch = self.upload(sid).json
        self.post('batches/' + batch['id'] + '/save', {'questions': [self.question()], 'confirm': True})
        self.post('observations', {'student': sid, 'date': batch['date'], 'text': '能说明思路'})
        report = self.post('reports', {'student': sid, 'date': batch['date'], 'kind': 'daily'}).json
        script = "from app import app; import json; print(json.dumps(app.test_client().get('/api/state').json))"
        result = subprocess.run([sys.executable, '-c', script], cwd=os.path.dirname(os.path.dirname(__file__)),
                                capture_output=True, text=True, check=True)
        restored = json.loads(result.stdout)
        self.assertIn(sid, [s['id'] for s in restored['students']])
        saved = next(b for b in restored['batches'] if b['id'] == batch['id'])
        self.assertEqual(saved['questions'][0]['answer'], '6')
        self.assertEqual(saved['status'], 'confirmed')
        self.assertIn(report['id'], [r['id'] for r in restored['reports']])
        self.assertTrue(any(o['student'] == sid for o in restored['observations']))
        with self.client.get('/photo/' + batch['photos'][0]) as response:
            self.assertEqual(response.status_code, 200)
        self.assertEqual(self.client.delete('/api/students/' + sid, headers={'X-CSRF-Token': self.csrf}).status_code, 200)
        remaining = self.client.get('/api/state').json
        for kind in ('batches', 'reports', 'observations'):
            self.assertFalse(any(item['student'] == sid for item in remaining[kind]))

    def test_gender_saved_and_not_sent_to_model(self):
        s = self.post('students', {'name': '隐私测试昵称', 'gender': '女'}).json
        self.assertEqual(s['gender'], '女')
        updated = self.post('students', {'id': s['id'], 'name': s['name']}).json
        self.assertEqual(updated['gender'], '女')
        self.assertEqual(self.post('students', {'name': '测试', 'gender': 'invalid'}).status_code, 400)
        b = self.upload(s['id']).json
        with patch('app.model', return_value={'questions': [self.question()]}) as mock:
            self.assertEqual(self.post('batches/' + b['id'] + '/grade', {}).status_code, 200)
            import json
            payload = json.dumps(mock.call_args.args[0], ensure_ascii=False)
            self.assertNotIn(s['name'], payload)
            self.assertNotIn('gender', payload)

    def test_full_correction_and_report(self):
        sid = self.student()
        b = self.upload(sid).json
        self.assertEqual(self.post('reports', {'student': sid, 'date': b['date'], 'kind': 'daily'}).status_code, 400)
        q = self.question()
        self.post('batches/' + b['id'] + '/save', {'questions': [q], 'confirm': False})
        self.assertEqual(self.post('reports', {'student': sid, 'date': b['date'], 'kind': 'daily'}).status_code, 400)
        self.post('batches/' + b['id'] + '/save', {'questions': [q], 'confirm': True})
        first = self.post('reports', {'student': sid, 'date': b['date'], 'kind': 'weekly'}).json
        self.assertIn('缺少上周有效记录', first['text'])
        self.assertNotRegex(first['text'], r'[0-9%]')
        child = self.upload(sid, b['id'], ['q1']).json
        q['verdict'] = 'correct'
        self.post('batches/' + child['id'] + '/save', {'questions': [q], 'confirm': True})
        self.assertEqual(stats([get(b['id']), get(child['id'])]), {'数学': {'correct': 0, 'total': 1}})
        self.assertEqual(get(b['id'])['questions'][0]['answer'], '6')
        reports = self.client.get('/api/state').json['reports']
        self.assertTrue(next(r for r in reports if r['id'] == first['id'])['stale'])
        self.assertEqual(self.post('reports', {'student': sid, 'date': b['date'], 'kind': 'weekly'}).status_code, 400)
        self.assertEqual(self.post('batches/' + b['id'] + '/save', {'questions': [q]}).status_code, 400)

    def test_cross_student_rejected_and_delete(self):
        sid = self.student()
        b = self.upload(sid).json
        self.post('batches/' + b['id'] + '/save', {'questions': [self.question()], 'confirm': True})
        self.assertEqual(self.upload(self.student(), b['id'], ['q1']).status_code, 400)
        photo = b['photos'][0]
        with self.client.get('/photo/' + photo) as response:
            self.assertEqual(response.status_code, 200)
        self.client.delete('/api/students/' + sid, headers={'X-CSRF-Token': self.csrf})
        self.assertEqual(self.client.get('/photo/' + photo).status_code, 404)

    def test_unknown_open_and_partial_stats(self):
        questions = [{'kind': k, 'verdict': v} for k, v in [('objective', 'correct'), ('objective', 'partial'), ('objective', 'unknown'), ('open', 'correct'), ('essay', 'wrong')]]
        self.assertEqual(stats([{'status': 'confirmed', 'subject': '语文', 'questions': questions}]), {'语文': {'correct': 1, 'total': 2}})
        self.assertEqual(dates('2026-10-25', True), ('2026-10-19', '2026-10-25'))

    def test_model_retry_replaces_not_duplicates(self):
        b = self.upload(self.student()).json
        with patch('app.model', return_value={'questions': [self.question()]}):
            for _ in range(2):
                self.assertEqual(self.post('batches/' + b['id'] + '/grade', {}).status_code, 200)
        self.assertEqual(len(get(b['id'])['questions']), 1)
        with patch('app.model', return_value={'questions': [{'kind': 'broken'}]}):
            self.assertEqual(self.post('batches/' + b['id'] + '/grade', {}).status_code, 400)
        self.assertEqual(len(get(b['id'])['questions']), 1)

    def test_empty_draft_can_be_saved_but_not_confirmed(self):
        b = self.upload(self.student()).json
        self.post('batches/' + b['id'] + '/save', {'questions': [self.question()]})
        response = self.post('batches/' + b['id'] + '/save', {'questions': [], 'confirm': False})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(get(b['id'])['questions'], [])
        self.assertEqual(self.post('batches/' + b['id'] + '/save', {'questions': [], 'confirm': True}).status_code, 400)

    def test_correction_only_day_and_latest_result(self):
        sid = self.student()
        original = self.upload(sid).json
        self.post('batches/' + original['id'] + '/save', {'questions': [self.question()], 'confirm': True})
        for n, verdict in enumerate(('correct', 'wrong')):
            child = self.upload(sid, original['id'], ['q1']).json
            child['date'] = '2026-10-24'
            put('batch', child)
            q = self.question()
            q['verdict'] = verdict
            self.post('batches/' + child['id'] + '/save', {'questions': [q], 'confirm': True})
        r = self.post('reports', {'student': sid, 'date': '2026-10-24', 'kind': 'daily'})
        self.assertEqual(r.status_code, 200)
        self.assertIn('订正中', r.json['text'])
        self.assertIn('仍有订正', r.json['text'])
        self.assertNotIn('已通过', r.json['text'])
        self.assertEqual(get(original['id'])['questions'][0]['verdict'], 'wrong')

    def test_weekly_evidence_and_observation_budget(self):
        sid = self.student()
        old = self.upload(sid).json
        old.update(date='2026-10-16', status='confirmed', questions=[self.question()])
        put('batch', old)
        now = self.upload(sid).json
        q1 = self.question()
        q1['verdict'] = 'correct'
        q2 = dict(q1, id='q2')
        now.update(status='confirmed', questions=[q1, q2])
        put('batch', now)
        text, _ = compose_report(sid, '2026-10-23', True)
        self.assertIn('表现改善', text)
        self.assertIn('不据此判断整体', text)
        q2['verdict'] = 'wrong'
        put('batch', now)
        text, _ = compose_report(sid, '2026-10-23', True)
        self.assertNotIn('表现改善', text)
        self.assertIn('仍有出现', text)
        self.post('observations', {'student': sid, 'date': '2026-10-23', 'text': '能说明思路。' * 400})
        text, _ = compose_report(sid, '2026-10-23', False)
        self.assertLessEqual(len(text), 180)
if __name__ == '__main__':
    unittest.main()
