# 大学生职业规划智能体

本地运行的职业规划演示应用：岗位与路径 → 导入简历或手动填写资料 → 按需修改 → 匹配和推荐 → 职业建议与 TXT 导出。

从安装启动到逐步完成岗位探索、资料整理、匹配和报告导出的操作指南见 [docs/项目使用全过程.md](docs/项目使用全过程.md)。

## 安装与启动（Windows / PowerShell）

需要 Python 3.12、Node.js 20+ 和 npm。首次安装需要网络；前端与 Python 的完整依赖分别锁在 frontend/package-lock.json 和 requirements.txt。

~~~powershell
cd C:/Users/Administrator/Desktop/智能体
./install.ps1
Copy-Item .env.example .env
# 用本机编辑器填写 .env，切勿把密钥发送到聊天或提交到版本库。
./start.ps1
~~~

打开 http://127.0.0.1:8000。关闭服务终端或按 Ctrl+C 停止。端口占用时使用 ./start.ps1 -Port 8001。脚本从自身目录定位文件，也可从别的目录调用。启动不重复安装依赖；修改前端后在 frontend 运行 npm.cmd run build 并重启服务。

.env 的 LLM_BASE_URL、LLM_MODEL、LLM_API_KEY 应使用你自己的可信兼容 Chat Completions 供应商；示例域名不提供服务。每次模型请求总时限45秒，连接故障、429和5xx最多自动重试一次。更改配置后重启。无需模型配置也能浏览岗位、路径，并对手动填写的资料进行确定性匹配；简历解析、个人分析报告和岗位建议需真实服务。

曾在早期示例中出现过真实密钥，已移除；该旧密钥应在供应商处轮换，不要继续使用。

## 两条演示路线

**手动路线**：在职业探索中查看 Java 开发工程师并设为目标 → 在“简历与个人报告”选择手动录入，填写软件工程专业 → 添加 Java 与 SQL → 可生成个人分析报告 → 在匹配报告查看基础与增强匹配度、资料已提及与资料未提及的要求及推荐 → 查看成长路径 → 生成岗位建议 → 复制与导出TXT。

**简历路线**：导入 samples/虚构简历.pdf（也可使用同名DOCX/TXT）→ 提取结果直接填入资料，按需修改或删除条目 → 按城市与月薪/日薪筛选推荐 → 比较基础/增强排序 → 切换目标岗位后刷新匹配 → 生成新建议并导出。

全部样例为虚构。samples/学生-*.json 提供零技能、部分匹配、关联技能和等级字段等案例，可用于 API 演示（文件名“待确认”“等级案例”沿用 matching-2.1 时期的命名，现按 matching-2.2 口径计算）。JSON 中的证据也是演示自述，不代表真实人员能力。

## 评分与边界

算法版本 matching-2.2（见 docs/adr/0002-mentioned-skills-without-confirmation-gate.md）。基础分 = 资料（简历或手动填写）已提及且等级大于0的必需标签数量 ÷ 必需标签总数，不要求逐项确认或证据。优先项不入分母，多余学生标签不稀释，重复标签只计一次。条目只分“资料已提及”和“资料未提及（不代表不具备）”；旧数据中的等级0按未提及处理。分数表示资料覆盖度，不是能力证明。

增强分中已提及的精确标签贡献为1，不按学生自评等级折算。岗位要求等级按“了解/熟悉/熟练”映射为1/2/3（无明确文字默认2），只用于展示。资料中提及的关联技能最多贡献0.25，多个不叠加，不代表已掌握。证书与素质按是否提及计0/1。空维度显示不适用；全部无要求则不可计算并排除推荐。

推荐最多5个典型岗位，默认基础分排序，同分按岗位ID。城市、薪资条件针对实际样本记录；同计薪周期区间重叠，日薪/月薪不换算。无薪资条件保留未知薪资。技能筛选要求全部所选标签出现。候选不足3个如实展示。

所有招聘信息来自赛题样本，不保证仍有效。岗位画像是初级职业基线，晋升与换岗路径为人工整理的条件性建议，不保证录用、薪资或直接转岗。数据口径与证据规则见 docs/数据字典.md；模型契约见 docs/AI接口契约.md。

## 文件与隐私

支持文本型PDF、DOCX、UTF-8/GB18030 TXT；单文件≤5MB、文本≤30000字符。扫描件、加密、损坏与超限输入给出错误。无OCR，不静默截断。

学生资料只保存在会话内存，刷新清空；服务器解析文件后释放，不保存简历或正文日志。模型生成会把相关输入发送给你配置的供应商，应在上传前删除不必要的身份信息。简历解析结果直接填入资料并参与匹配，请在匹配前核对并删除不准确的条目；证据摘录只用于核对，不能当作能力真实性证明。简历姓名只在当前会话展示，不进入匹配、后续模型请求或TXT报告。

## 验证与重建

~~~powershell
.venv/Scripts/python.exe scripts/build_data.py
.venv/Scripts/python.exe -m pytest tests -q
npm.cmd --prefix frontend test
npm.cmd --prefix frontend run build
.venv/Scripts/python.exe -m ruff check backend scripts tests
npm.cmd --prefix frontend run lint
npm.cmd ci --prefix tests/browser
# 先启动测试专用服务器（模型JSON为替身，绝不能当真实API证据）
.venv/Scripts/python.exe tests/e2e_server.py
# 另一个终端：默认用本机Edge；也支持安装Playwright Chromium后设PW_CHANNEL=chromium
npm.cmd --prefix tests/browser test
# 正常生产服务启动后，真正调用本机配置的供应商：
.venv/Scripts/python.exe scripts/smoke_live.py
~~~

浏览器测试默认 http://127.0.0.1:8011；可通过 E2E_URL 改地址。E2E服务只替换模型JSON，不替换匹配、验证、文件解析和报告组装。真实调用脚本缺配置时退出码2，失败退出码1，全部步骤成功才退出0；只输出脱敏状态。

独立干净Python安装可用 ./install.ps1 -VenvPath .venv-acceptance -SkipFrontend，随后用相同 -VenvPath 启动。最终验收状态和已知限制以 docs/acceptance/后端测试.txt 为准；mock自动化不替代 P2/P5 真实调用门槛。

项目结构：backend/app 为服务与业务逻辑，backend/data 为生成数据，frontend 为界面，scripts 为数据和验收入口，tests 为测试，samples 为虚构示例，competition 为只读原始赛题材料。docs 存放契约、数据字典、审定记录和操作指南；docs/acceptance 为验收产物，docs/learning 为项目教学材料，docs/archive 为历史过程记录；.scratch 为按功能划分的需求与 issue。
