# pdf-fetcher

`pdf-fetcher` 是一个面向 Zotero 9 的文献原文获取插件。插件依托聚联医疗/JLSS 服务提交文献查询任务，并在任务成功后把 PDF 原文导入为 Zotero 条目的附件。

## 主要功能

- 在 Zotero 条目右键菜单中添加 `通过聚联医疗获取原文`。
- 在 Zotero 设置页中提供 `pdf-fetcher` 设置面板，用于保存聚联医疗 token。
- 按 `DOI > PMID > 标题 > URL` 的优先级提取条目信息并提交查询。
- 查询聚联医疗用户中心任务列表，匹配当前条目的查询记录。
- 任务成功时自动下载 PDF，并作为当前 Zotero 条目的子附件导入。
- 任务仍在人工查找中时，为条目添加 `fetching PDF` 标签；再次点击菜单时只检查已有任务，不重复提交。

## 前置条件

拥有聚联医疗 [https://jlyl.jlss.vip/jss](https://jlyl.jlss.vip/jss/#/index) 的机构认证账号，可享受其文献传递等服务。

## 下载安装

从 GitHub Release 下载最新版本的 `pdf-fetcher.xpi`：

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
3. 插件会提交查询并在约 7 秒后检查聚联医疗任务列表。
4. 如果任务已经成功，PDF 会被导入为该条目的附件。
5. 如果任务仍在人工查找中，条目会被添加 `fetching PDF` 标签；稍后再次点击同一菜单即可继续检查结果。

## 本地构建

```bash
npm install
npm run build
```

构建完成后，插件安装包会生成在：

```text
.scaffold/build/pdf-fetcher.xpi
```

## 当前状态

当前版本已经完成 Zotero 9 beta 下的基本可用流程，包括 token 设置、任务提交、任务列表匹配、成功任务 PDF 导入，以及人工查找中标签追踪。

详细接口分析记录见 [docs/network-analysis.md](docs/network-analysis.md)。
