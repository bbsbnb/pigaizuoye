let state, currentStudent = null, currentBatch = null, currentDate, activeTab = 'work', showArchived = false;
const $ = s => document.querySelector(s);
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const icons = {plus:'Plus',back:'ArrowLeft',edit:'Pencil',camera:'Camera',copy:'Copy',close:'X',check:'Check',trash:'Trash2',exit:'LogOut'};
const icon = name => lucide.createElement(lucide.icons[icons[name]], {class:'icon','aria-hidden':'true'}).outerHTML;
const button = (text, action, cls='', symbol='') => `<button type="button" class="${cls}" data-action="${action}">${symbol ? icon(symbol) : ''}${text}</button>`;
const verdicts = {correct:'正确',partial:'部分正确',wrong:'需订正',unknown:'无法判定'};
const kinds = {objective:'客观题',open:'开放性阅读',essay:'作文 / 书面表达'};
const statusName = {draft:'待批改',review:'待确认',confirmed:'已确认'};
function toast(text) { $('#toast').textContent=text; $('#toast').style.display='block'; clearTimeout(window.toastTimer); window.toastTimer=setTimeout(()=>$('#toast').style.display='none',6500); }
async function api(path, body, method='POST') {
  const options={method,headers:{'X-CSRF-Token':state?.csrf || ''}};
  if(body instanceof FormData) options.body=body;
  else if(body !== undefined){ options.headers['Content-Type']='application/json'; options.body=JSON.stringify(body); }
  const response=await fetch('/api/'+path,options);
  const data=await response.json().catch(()=>({error:'请求未完成，请稍后重试'}));
  if(!response.ok) throw new Error(data.error || '操作失败');
  return data;
}
async function refresh(){state=await api('state',undefined,'GET');currentDate ||= state.today;render();}
function modal(title,content){$('#dialog-content').innerHTML=`<div class="dialog-head"><h2>${title}</h2><button class="icon-only" data-action="close" title="关闭">${icon('close')}</button></div>${content}`;$('#modal').showModal();}
function closeModal(){$('#modal').close();}
function student(){return state.students.find(s=>s.id===currentStudent);}
function render(){
  $('#account').innerHTML=state.authenticated ? button('退出','logout','text-button','exit') : '<span class="muted">教师工作台</span>';
  if(!state.authenticated){
    $('#app').innerHTML=`<section class="login"><div class="eyebrow">知禾 · 教师工作台</div><h1>${state.setup?'开始今天的辅导':'欢迎回来'}</h1><p class="muted">${state.setup?'建立你的专属学生学习档案':'登录查看学生作业与学习记录'}</p><form id="auth-form"><label>教师密码<input name="password" type="password" autocomplete="${state.setup?'new-password':'current-password'}" minlength="12" required></label>${state.setup?'<label class="check"><input type="checkbox" name="consent" required>已取得学生监护人对作业照片存储及AI辅助处理的必要授权</label><p class="muted">至少12位密码。仅教师可以访问学生记录。</p>':''}<button class="primary" type="submit">${state.setup?'创建教师账户':'登录'}</button></form></section>`; return;
  }
  if(currentBatch) return renderReview();
  if(currentStudent && student()) return renderStudent();
  currentStudent=null;
  const students=state.students.filter(s=>Boolean(s.archived)===showArchived);
  const batches=state.batches.filter(b=>b.date===state.today);
  const pending=batches.filter(b=>b.status!=='confirmed').length;
  $('#app').innerHTML=`<div class="toolbar"><div><div class="eyebrow">教师工作台 / ${state.today.replaceAll('-','.')}</div><h1>学生与作业</h1><span class="muted">人教版 · 三年级上册</span></div>${button('添加学生','add-student','primary','plus')}</div>
    <div class="metrics"><div class="metric"><span class="muted">在读学生</span><strong>${state.students.filter(s=>!s.archived).length}</strong></div><div class="metric"><span class="muted">今日作业批次</span><strong>${batches.length}</strong></div><div class="metric"><span class="muted">待审核批次</span><strong>${pending}</strong></div></div>
    ${!state.aiReady?'<div class="notice">模型尚未连接 · 作业可上传、手动审核和生成记录摘要。真实AI批改需先配置服务。</div>':''}
    <div class="section-title"><h2>${showArchived?'归档学生':'我的学生'}</h2>${button(showArchived?'查看在读':'查看归档','toggle-archived','text-button')}</div>
    ${students.length?`<div class="grid">${students.map(s=>{const bs=batches.filter(b=>b.student===s.id);const report=state.reports.find(r=>r.student===s.id&&r.kind==='daily'&&r.date===state.today);return `<button class="student" data-action="student" data-id="${s.id}"><div class="student-top"><span class="avatar">${esc(s.name.slice(0,1))}</span><div><strong>${esc(s.name)}</strong><div class="muted">三年级 · 上册</div></div></div><div class="actions"><span class="badge ${bs.some(b=>b.status!=='confirmed')?'warn':''}">${bs.length?bs.some(b=>b.status!=='confirmed')?'有待审核作业':'作业已确认':'今日暂无上传'}</span>${report?`<span class="badge blue">${report.stale?'日报待更新':'日报已生成'}</span>`:''}</div></button>`;}).join('')}</div>`:'<div class="empty"><img src="/static/notebook.png" alt="打开的练习本"><h3>这里还没有学生</h3><p>添加学生后，建立独立作业与学习记录。</p></div>'}`;
}
function renderStudent(){
  const s=student(), batches=state.batches.filter(b=>b.student===s.id&&b.date===currentDate), observation=state.observations.find(o=>o.student===s.id&&o.date===currentDate);
  const stats={};for(const b of batches.filter(b=>b.status==='confirmed'&&!b.parent)){for(const q of b.questions){if(q.kind==='objective'&&q.verdict!=='unknown'){stats[b.subject] ||= {n:0,c:0};stats[b.subject].n++;stats[b.subject].c+=q.verdict==='correct';}}}
  $('#app').innerHTML=`${button('学生列表','home','text-button','back')}<div class="toolbar"><div><h1>${esc(s.name)}</h1><span class="muted">${esc(s.books)}</span></div><div class="actions"><input aria-label="作业日期" id="date" type="date" value="${currentDate}">${button('档案','edit-student','','edit')}</div></div>
    <div class="actions">${button('上传作业','upload','primary','camera')}${button('生成今日总结','daily')}${button('生成本周总结','weekly')}</div>
    <nav class="tabs">${button('当天作业','tab-work',activeTab==='work'?'active':'')}${button('学习报告','tab-reports',activeTab==='reports'?'active':'')}</nav>
    ${activeTab==='work'?`${Object.keys(stats).length?`<div class="actions">${Object.entries(stats).map(([k,v])=>`<span class="badge">${k} · 首次正确 ${v.c}/${v.n} · ${Math.round(v.c/v.n*100)}%</span>`).join('')}</div>`:''}
    ${batches.length?batches.map(b=>`<article class="batch"><img class="thumb" alt="${esc(b.subject)}作业照片" src="/photo/${b.photos[0]}"><div class="grow"><h3>${b.subject}${b.parent?' · 订正复查':''}</h3><span class="muted">${b.photos.length} 张照片</span> <span class="badge ${b.status==='confirmed'?'':'warn'}">${statusName[b.status]}</span></div><div class="actions"><button data-action="review" data-id="${b.id}">${b.status==='confirmed'?'查看记录':'批改审核'}</button><button class="icon-only danger" data-action="delete-batch" data-id="${b.id}" title="删除作业">${icon('trash')}</button></div></article>`).join(''):'<div class="empty"><img src="/static/notebook.png" alt="打开的练习本"><h3>当天暂无作业照片</h3><p>语文、数学、英语</p></div>'}
    <section style="margin-top:30px"><h2>老师观察</h2><textarea id="observation" aria-label="老师观察" placeholder="记录实际观察到的学习表现">${esc(observation?.text||'')}</textarea><div class="actions" style="margin-top:12px">${button('保存观察','save-observation')}</div></section>`:renderReports(s.id)}`;
}
function renderReports(sid){const reports=state.reports.filter(r=>r.student===sid).sort((a,b)=>b.date.localeCompare(a.date));return reports.length?reports.map(r=>`<article class="report" data-report="${r.id}"><div class="report-title"><h3>${r.kind==='daily'?'每日学习反馈':'本周学习反馈'} <span class="muted">${r.date}${r.kind==='weekly'?' 至 '+r.end:''}</span></h3>${r.stale?'<span class="badge warn">记录变化 · 待更新</span>':'<span class="badge">已保存</span>'}</div><textarea aria-label="报告正文" class="report-text">${esc(r.text)}</textarea><div class="report-meta">${r.text.length} 字 · ${r.sources.length} 份来源记录</div><div class="actions"><button data-action="save-report" data-id="${r.id}">${icon('check')}保存编辑</button><button data-action="copy-report" data-id="${r.id}">${icon('copy')}复制文字</button><button data-action="sources" data-id="${r.id}" class="text-button">查看依据</button></div></article>`).join(''):'<div class="empty"><h3>暂无学习报告</h3><p>确认作业后，可生成该学生的日报和周报。</p></div>';}
function renderReview(){
  const b=state.batches.find(b=>b.id===currentBatch);if(!b){currentBatch=null;return render();}
  const readonly=b.status==='confirmed';
  $('#app').innerHTML=`${button('返回学生','back-student','text-button','back')}<div class="toolbar"><div><h1>${esc(student().name)} · ${b.subject}${b.parent?'订正':'作业'}</h1><span class="muted">${b.date}</span> <span class="badge">${statusName[b.status]}</span></div>${!readonly?button(b.questions.length?'重新AI初批':'AI初步批改','grade','primary'):''}</div>
    <div class="review"><div class="photos">${b.photos.map(p=>`<a href="/photo/${p}" target="_blank" rel="noopener"><img src="/photo/${p}" alt="作业原图"></a>`).join('')}</div><div class="questions" id="questions">${b.questions.length?b.questions.map(q=>questionHTML(q,readonly,b)).join(''):'<p class="muted">暂无批改结果</p>'}</div></div>
    <div class="bottom-actions">${readonly?(!b.parent?button('上传所选题目订正','correction','primary','camera'):''):button('补拍照片','supplement','','camera')+button('添加题目','add-question','','plus')+button('保存草稿','save-draft')+button('确认全部批改','confirm-batch','primary','check')}</div>`;
}
function questionHTML(q,readonly,b){
  const opts=(map,value)=>Object.entries(map).map(([k,v])=>`<option value="${k}" ${k===value?'selected':''}>${v}</option>`).join('');
  let correction='';
  if(readonly&&!b.parent&&q.verdict!=='correct'){
    const history=state.batches.filter(x=>x.parent===b.id&&x.status==='confirmed').flatMap(x=>x.questions.filter(t=>t.id===q.id).map(t=>({date:x.date,confirmed:x.confirmed_at||'',q:t}))).sort((a,c)=>a.date.localeCompare(c.date)||a.confirmed.localeCompare(c.confirmed));
    correction=`<label class="check"><input class="correction-choice" type="checkbox" value="${q.id}">订正此题 · ${history.length?(history.at(-1).q.verdict==='correct'?'已订正':history.at(-1).q.verdict==='unknown'?'复查待判定':'仍有问题'):'待订正'}</label>`;
  }
  return `<section class="question" data-qid="${esc(q.id||'')}">${correction}<div class="row"><label>题号<input data-field="label" value="${esc(q.label)}" ${readonly?'disabled':''}></label><label>类型<select data-field="kind" ${readonly?'disabled':''}>${opts(kinds,q.kind)}</select></label><label>判定<select data-field="verdict" ${readonly?'disabled':''}>${opts(verdicts,q.verdict)}</select></label></div>${[['text','题目'],['answer','学生答案'],['explanation','问题与解释'],['reference','参考解法']].map(([key,name])=>`<label>${name}<textarea data-field="${key}" ${readonly?'disabled':''}>${esc(q[key])}</textarea></label>`).join('')}<label>知识点<input data-field="knowledge" value="${esc(q.knowledge)}" ${readonly?'disabled':''}></label>${!readonly&&!b.parent?button('移除此题','remove-question','text-button danger','trash'):''}</section>`;
}
function readQuestions(){return [...document.querySelectorAll('.question')].map(el=>{const q={id:el.dataset.qid};el.querySelectorAll('[data-field]').forEach(f=>q[f.dataset.field]=f.value);return q;});}
function studentModal(edit){const s=edit?student():{};modal(edit?'学生档案':'添加学生',`<form id="student-form"><label>姓名或昵称<input name="name" maxlength="40" value="${esc(s.name||'')}" required></label><label>性别<select name="gender">${['未填写','男','女'].map(value=>`<option ${value===(s.gender||'未填写')?'selected':''}>${value}</option>`).join('')}</select></label><label>教材信息<textarea name="books">${esc(s.books||'人教版三年级上册；英语具体版本待确认')}</textarea></label><button class="primary" type="submit">保存学生</button>${edit?`<hr><div class="actions">${button(s.archived?'恢复在读':'归档学生','archive')}${button('删除学生及全部资料','delete-student','text-button danger','trash')}</div>`:''}</form>`);$('#student-form').dataset.id=s.id||'';}
function uploadModal(parent){
  let selected=[];if(parent){selected=[...document.querySelectorAll('.correction-choice:checked')].map(x=>x.value);if(!selected.length)return toast('请先勾选需要订正的题目');}
  modal(parent?'上传订正照片':'上传作业',`<form id="upload-form" data-parent="${parent?.id||''}" data-selected='${JSON.stringify(selected)}'><label>科目<select name="subject" ${parent?'disabled':''}>${['数学','语文','英语'].map(s=>`<option ${parent?.subject===s?'selected':''}>${s}</option>`).join('')}</select></label><label>作业日期<input type="date" name="date" value="${currentDate}" required></label><label>作业照片<input class="file-input" type="file" name="photos" accept="image/jpeg,image/png,image/webp" multiple></label><label>直接拍照<input type="file" id="camera" accept="image/*" capture="environment"></label><p class="muted">JPG、PNG、WebP · 每批最多12张 · 总计32MB</p><button class="primary" type="submit">上传并进入审核</button></form>`);
}
async function generate(kind){
  const start=new Date(currentDate+'T00:00:00Z');if(kind==='weekly')start.setUTCDate(start.getUTCDate()-((start.getUTCDay()+6)%7));
  const date=start.toISOString().slice(0,10), existing=state.reports.find(r=>r.student===currentStudent&&r.kind===kind&&r.date===date);
  if(existing&&!confirm('重新生成将替换这份报告及已有文字编辑，是否继续？'))return;
  await api('reports',{student:currentStudent,date:currentDate,kind,replace:Boolean(existing)});activeTab='reports';await refresh();toast('报告草稿已生成，请审核文字后分享');
}
document.addEventListener('change',e=>{if(e.target.id==='date'){if(dirtyReports()&&!confirm('报告有未保存的修改，切换日期将丢弃修改。是否继续？')){e.target.value=currentDate;return;}currentDate=e.target.value;if(currentDate)render();}});
function dirtyReports(){return [...document.querySelectorAll('[data-report]')].some(el=>el.querySelector('textarea').value!==state.reports.find(r=>r.id===el.dataset.report)?.text);}
window.addEventListener('beforeunload',e=>{if(dirtyReports()){e.preventDefault();e.returnValue='';}});
document.addEventListener('click',async e=>{
  const el=e.target.closest('[data-action]');if(!el)return;
  const action=el.dataset.action;el.disabled=true;
  try{
    if(dirtyReports()&&!['copy-report','save-report','close'].includes(action)&&!confirm('报告有未保存的修改，继续将丢弃这些修改。是否继续？'))return;
    if(action==='close')closeModal();
    else if(action==='logout'){await api('logout',{});currentStudent=currentBatch=null;await refresh();}
    else if(action==='home'){currentStudent=currentBatch=null;render();}
    else if(action==='student'){currentStudent=el.dataset.id;activeTab='work';currentDate=state.today;render();}
    else if(action==='toggle-archived'){showArchived=!showArchived;render();}
    else if(action==='add-student'||action==='edit-student')studentModal(action==='edit-student');
    else if(action==='archive'){await api('students',{...student(),archived:!student().archived});closeModal();currentStudent=null;await refresh();}
    else if(action==='delete-student'){if(confirm('永久删除该学生、全部照片、批改、观察和报告？此操作无法撤销。')){await api('students/'+currentStudent,undefined,'DELETE');closeModal();currentStudent=null;await refresh();}}
    else if(action==='tab-work'||action==='tab-reports'){activeTab=action==='tab-work'?'work':'reports';render();}
    else if(action==='upload')uploadModal();
    else if(action==='supplement'){
      const questions=readQuestions();
      if(questions.length){await api('batches/'+currentBatch+'/save',{questions,confirm:false});toast('批改草稿已保存');}
      uploadModal();const b=state.batches.find(x=>x.id===currentBatch), f=$('#upload-form');
      f.dataset.supplement=b.id;f.subject.value=b.subject;f.subject.disabled=true;f.date.value=b.date;f.date.disabled=true;
    }
    else if(action==='review'){currentBatch=el.dataset.id;render();window.scrollTo(0,0);}
    else if(action==='back-student'){if(state.batches.find(b=>b.id===currentBatch)?.status!=='confirmed'&&!confirm('返回将丢弃尚未保存的编辑，是否继续？'))return;currentBatch=null;render();}
    else if(action==='delete-batch'){if(confirm('删除该作业照片、批改及关联订正？相关报告将标记待更新。')){await api('batches/'+el.dataset.id,undefined,'DELETE');await refresh();}}
    else if(action==='grade'){
      const b=state.batches.find(b=>b.id===currentBatch);if(b.questions.length&&!confirm('重新批改将替换当前未确认内容，是否继续？'))return;
      toast('正在识别和批改，请稍候…');await api('batches/'+currentBatch+'/grade',{});await refresh();toast('AI初批完成，请对照原图审核');
    }
    else if(action==='add-question'){
      const b=state.batches.find(b=>b.id===currentBatch);
      if(b.parent){const orig=state.batches.find(x=>x.id===b.parent);const present=readQuestions().map(q=>q.id);const q=orig.questions.find(q=>b.selected.includes(q.id)&&!present.includes(q.id));if(!q)return toast('所有订正题目已添加');$('#questions').insertAdjacentHTML('beforeend',questionHTML({...q,answer:'',verdict:'unknown',explanation:'',reference:''},false,b));}
      else $('#questions').insertAdjacentHTML('beforeend',questionHTML({kind:'objective',verdict:'unknown'},false,b));
    }
    else if(action==='remove-question')el.closest('.question').remove();
    else if(action==='save-draft'||action==='confirm-batch'){
      if(action==='confirm-batch'&&!confirm('确认已检查全部题目？确认后首次记录将锁定，后续变化通过订正保存。'))return;
      await api('batches/'+currentBatch+'/save',{questions:readQuestions(),confirm:action==='confirm-batch'});await refresh();toast(action==='confirm-batch'?'批改已确认':'草稿已保存');
    }
    else if(action==='correction')uploadModal(state.batches.find(b=>b.id===currentBatch));
    else if(action==='save-observation'){await api('observations',{student:currentStudent,date:currentDate,text:$('#observation').value});await refresh();toast('观察已保存');}
    else if(action==='daily'||action==='weekly')await generate(action);
    else if(action==='save-report'){const text=el.closest('.report').querySelector('textarea').value;await api('reports/'+el.dataset.id,{text});state.reports.find(r=>r.id===el.dataset.id).text=text;toast('报告已保存');}
    else if(action==='copy-report'){
      const text=el.closest('.report').querySelector('textarea').value;
      if(navigator.clipboard&&window.isSecureContext)await navigator.clipboard.writeText(text);
      else{const ta=el.closest('.report').querySelector('textarea');ta.focus();ta.select();if(!document.execCommand('copy'))throw Error('当前浏览器无法复制，请长按选中文字复制');}
      toast('已复制当前报告文字');
    }
    else if(action==='sources'){const r=state.reports.find(r=>r.id===el.dataset.id);modal('报告来源',r.sources.map(id=>{const b=state.batches.find(b=>b.id===id);return b?`<p>${b.date} · ${b.subject} · ${b.parent?'订正':'首次作业'} <button data-action="source-review" data-id="${id}">查看</button></p>`:'<p class="muted">来源已删除，请重新生成报告</p>';}).join(''));}
    else if(action==='source-review'){closeModal();currentBatch=el.dataset.id;render();}
  }catch(err){toast(err.message);}finally{el.disabled=false;}
});
document.addEventListener('submit',async e=>{
  e.preventDefault();const f=e.target, submit=f.querySelector('[type=submit]');submit.disabled=true;
  try{
    if(f.id==='auth-form'){await api('auth',{password:f.password.value,consent:Boolean(f.consent?.checked)});await refresh();}
    else if(f.id==='student-form'){const result=await api('students',{id:f.dataset.id,name:f.elements.name.value,gender:f.gender.value,books:f.books.value,archived:student()?.archived||false});closeModal();currentStudent=result.id;await refresh();}
    else if(f.id==='upload-form'){
      const data=new FormData(f);data.set('student',currentStudent);data.set('subject',f.subject.value);data.set('parent',f.dataset.parent);data.set('selected',f.dataset.selected);
      data.set('date',f.date.value);data.set('supplement',f.dataset.supplement||'');
      const photos=[...f.photos.files,...$('#camera').files];data.delete('photos');photos.forEach(p=>data.append('photos',p));
      if(!photos.length)throw Error('请选择或拍摄照片');
      const b=await api('upload',data);currentDate=f.date.value;closeModal();currentBatch=b.id;await refresh();toast('照片已保存');
    }
  }catch(err){toast(err.message);}finally{submit.disabled=false;}
});
refresh().catch(e=>toast(e.message));
