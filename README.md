# pdf-fetcher

`pdf-fetcher` 是一个面向 Zotero 的文献原文获取插件。插件依托聚联医疗/JLSS 服务提交文献查询任务，并在任务成功后把 PDF 原文导入为 Zotero 条目的附件。

## 主要功能

- 在 Zotero 条目右键菜单中添加 `通过聚联医疗获取原文`。
- 在 Zotero 设置页中提供 `pdf-fetcher` 设置面板，用于保存聚联医疗 token、开关自动接力获取 PDF、打开项目主页。
- 按 `DOI > PMID > 标题 > URL` 的优先级提取条目信息并提交查询。
- 查询聚联医疗用户中心任务列表，匹配当前条目的查询记录。
- 任务成功时自动下载 PDF，并作为当前 Zotero 条目的子附件导入。
- 提交成功即添加 `fetching PDF` 标签；若首次检查时仍未完成，再次点击菜单只检查已有任务。
- 可选自动接力：通过浏览器 Connector 或 DOI/PMID 新增的条目，在确认 Zotero 的 PDF 获取流程结束且仍无 PDF 后，才提交给聚联医疗。

## 前置条件

拥有聚联医疗 [https://jlyl.jlss.vip/jss](https://jlyl.jlss.vip/jss/#/index) 的机构认证账号，可享受其文献传递等服务。

## Zotero 版本要求

- **安装范围：** XPI 声明的最低版本为 `6.999`，最高版本为 `10.*`。
- **自动获取 PDF 全文：** 需要 Zotero 10.x，默认关闭。若该版本缺少原生接口，插件会跳过对应的自动获取入口，仍可右键手动获取。
- **验证范围：** 已核对 Zotero 10.0.7 的相关源码，并在 Zotero 10.0.8 和 Chrome Zotero Connector 5.0.217 的环境中试用了浏览器保存后的自动获取。其他版本未逐一实测。

## 下载安装

从 GitHub Releases 下载最新的安装包：

[下载 pdf-fetcher.xpi](https://github.com/HiYvri/pdf-fetcher/releases/latest/download/pdf-fetcher.xpi)

安装步骤：

1. 打开 Zotero。
2. 进入 `工具 -> 插件`。
3. 选择从文件安装插件，安装下载的 `pdf-fetcher.xpi`。
4. 如 Zotero 提示，重启 Zotero。

## Token 设置

聚联医疗接口地址固定为 `https://api.jlss.vip`。Zotero 插件不会自动继承浏览器登录状态，需要在插件设置页中填写网站 token。

获取 token 的基本方法：

1. 在浏览器登录聚联医疗网站。
2. 打开浏览器开发者工具，进入 `Application/应用 -> Local Storage`。
3. 选择 `jlyl.jlss.vip` 或 `jlss.vip` 相关站点，复制名为 `token` 的值。
4. 不包括两边引号，只保留数字和字母。
5. 回到 Zotero 的 `pdf-fetcher` 设置页，粘贴 token 并保存。

## 使用方法

1. 在 Zotero 中选中一个普通文献条目。
2. 右键点击条目，选择 `通过聚联医疗获取原文`。
3. 插件会提交查询，添加 `fetching PDF` 标签，并在约 7 秒后检查一次聚联医疗任务列表。
4. 如果任务已经成功，PDF 会被导入为该条目的附件。
5. 如果任务仍在人工查找中，标签会保留；稍后再次点击同一菜单即可继续检查结果。

在 Zotero 的 `设置 → pdf-fetcher` 勾选“自动获取PDF全文”即可开启。聚联医疗确认收到任务后，插件会显示“已提交到聚联医疗，7 秒后查询结果”，并在约 7 秒后检查一次；待查任务仍用右键继续检查。

## 本地构建

```bash
npm install
npm run test:unit
npm run build
```

构建完成后，插件安装包会生成在：

```text
.scaffold/build/pdf-fetcher.xpi
```

详细接口分析记录见 [docs/network-analysis.md](docs/network-analysis.md)。
