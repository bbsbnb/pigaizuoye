import io
import os
import tempfile
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
        cls.client.post('/api/auth', json={'password': 'test-password-123', 'consent': True}, headers={'X-CSRF-Token': cls.csrf})
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

    def test_auth_and_csrf(self):
        anonymous = app.test_client()
        self.assertEqual(anonymous.get('/photo/anything.jpg').status_code, 401)
        self.assertEqual(self.client.post('/api/students', json={'name': '无令牌'}).status_code, 403)

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
