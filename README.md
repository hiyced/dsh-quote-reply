# 引用气泡回复

[English](README.en.md)

给 DeepSeek Harness 用的引用回复插件。**划选文字，在选区旁写回复。** 同一条回复可以引用多段原文，加入聊天框后会显示为一个可删除的气泡。

![操作演示：划选原文，在弹窗里回复，再选一段并加入聊天框草稿](docs/images/quote-reply-demo.gif)

## 功能

- **就地回复。** 划选后点「引用回复」，在选区旁写。原文最多预览三行，悬停或点击可以看全文。
- **一起回答多段原文。** 点「＋ 再选一段」，选中另一段后点「加入引用」。已写的回复会保留。
- **草稿一目了然。** 每条引用回复以一个行内气泡显示。悬停可看全文，点 `×` 可删除这一条。
- **照常发送。** 用聊天框的发送按钮提交，原文会展开成标准 Markdown 引用，与回复之间留一行空白。界面跟随 Harness 的中英文设置。

![聊天框中的两条可删除的行内引用回复](docs/images/composer-bubbles.png)

## 安装

需要 DeepSeek Harness `0.2.2-rc.5` 或兼容的更新 `0.2.x` 版本。已在 `0.2.2-rc.5` 的 Web 界面验证。

在 DSH NEXT 打开「插件 → 插件市场」，搜索 `dsh-quote-reply`，选择「会话与消息」里 GitHub 作者为 **`hiyced`** 的条目。

<details>
<summary>从本地仓库安装</summary>

```sh
git clone https://github.com/hiyced/dsh-quote-reply.git
cd dsh-quote-reply
```

桌面端先启动一次 Harness 完成初始化，再彻底退出。在仓库目录执行以下命令，然后重新打开应用。

```sh
dsh plugin --profile desktop add "link:$PWD"
```

macOS 上也可用应用自带的命令行。

```sh
"/Applications/DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/dsh" plugin --profile desktop add "link:$PWD"
```

Web 端执行以下命令，再打开终端显示的地址。

```sh
dsh plugin --profile web add "link:$PWD"
dsh web
```

</details>

## 用法

1. 在会话消息里划选文字，点选区旁的「引用回复」。
2. 写回复，按 `Enter` 或点蓝色上箭头，把内容加入聊天框草稿。
3. 需要时再加几条。准备好后，用聊天框的发送按钮一次发出。

弹窗里用 `Shift+Enter` 换行，按 `Esc`、点「Esc 取消」或点击弹窗外可关闭。回复为空时，「加入草稿」不可用。
