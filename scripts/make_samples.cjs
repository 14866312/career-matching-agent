// Fictional sample generator; docx is a sample-tool dependency.
const fs = require('fs');
const path = require('path');
const {Document, Packer, Paragraph, TextRun, HeadingLevel} = require('docx');
const out = path.resolve(__dirname, '../samples');
fs.mkdirSync(out, {recursive:true});
const lines = [
'虚构学生简历 · 仅用于功能演示',
'专业：软件工程',
'职业意向：Java开发工程师；城市：北京',
'技能：了解Java，在课程项目中编写了图书借阅类和单元测试。',
'技能：了解SQL，在课程项目中编写了查询与联表语句。',
'技能：使用Git提交课程代码并处理过一次合并冲突。',
'项目经历：与三位同学协作开发图书管理课程项目，负责Java借阅逻辑。',
'通用素质：在团队协作中记录分工，每周向同学沟通问题与进度。',
'证书：暂无个人证书。',
'声明：以上经历完全虚构，不包含真实姓名、联系方式或身份信息。'];
fs.writeFileSync(path.join(out,'虚构简历.txt'),lines.join(String.fromCharCode(10)),'utf8');
const doc = new Document({creator:'Career Compass',title:'虚构学生演示简历',
styles:{default:{document:{run:{font:'Microsoft YaHei',size:22}}}},
sections:[{properties:{page:{size:{width:11906,height:16838},margin:{top:1134,right:1134,bottom:1134,left:1134}}},
children:lines.map((s,i)=>new Paragraph({heading:i===0?HeadingLevel.TITLE:undefined,
spacing:{after:220},children:[new TextRun({text:s,bold:i===0})]}))}]});
Packer.toBuffer(doc).then(b=>fs.writeFileSync(path.join(out,'虚构简历.docx'),b));
const ability=(tag,label,level,evidence,confirmed=true)=>({tag_id:tag,label,level,evidence,confirmed});
const base={major:'软件工程',skills:[],certificates:[],qualities:[],experiences:'虚构课程项目，仅用于演示',intention:{target_job_id:'java',city:''},confirmed:true,advantages:[],improvements:[]};
const partial={...base,skills:[ability('java','Java',1,'Java课程项目：编写图书借阅类'),ability('sql','SQL',1,'SQL课程项目：查询与联表练习')]};
const cases={zero:base,partial,pending:{...base,skills:[ability('java','Java',2,'',false)]},related:{...base,skills:[ability('javascript','JavaScript',2,'JavaScript课程练习')]},levels:{...base,skills:[ability('java','Java',3,'独立实现Java课程服务'),ability('sql','SQL',1,'SQL查询课程作业')]}};
const filenames={
  zero:'学生-零技能.json',
  partial:'学生-部分匹配.json',
  pending:'学生-待确认.json',
  related:'学生-关联技能.json',
  levels:'学生-等级案例.json',
};
for(const [name,data] of Object.entries(cases))fs.writeFileSync(path.join(out,filenames[name]),JSON.stringify(data,null,2));
console.log('Fictional TXT/DOCX and five student fixtures generated.');
