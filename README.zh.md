# Callout Copy Button (typora-community-plugin)

[English](README.md) | [简体中文](README.zh.md)

从 [alythobani/obsidian-callout-copy-buttons](https://github.com/alythobani/obsidian-callout-copy-buttons) 移植，目标为 Typora **原生 GitHub 风格 alert**（`> [!NOTE]` 语法，Typora ≥ 1.8 渲染出的 `.md-alert`）。

每个 alert 右上角放一排小按钮，设置里**三个独立开关**（与原版 Reading mode 的开关模型一致）——想只留一个按钮，把另外两个关掉即可。默认只开"选中"。

## 三种行为（以这段 callout 为例）

```markdown
> [!Note]
> type: strikeout
> page: 1
```

| 开关 | 按钮 | 点击效果 | 上例产出 |
|---|---|---|---|
| Show "Select callout" button（默认开） | 🖱 指针图标 | **选中整个 callout**（含 `[!Note]` 标题行），之后 Ctrl+C 走 Typora 自己的复制逻辑，与手动框选一致 | 编辑器内出现选区 |
| Show "Copy (plain text)" button | `P` | 复制**正文**纯文本：无标题行、无 `> ` 前缀、无行内标记 | `type: strikeout\npage: 1` |
| Show "Copy (Markdown)" button | `M` | 复制**整个 callout** 的 Markdown 源码：`> [!Note]` 标题行 + `> ` 前缀齐全，粘贴到任何 Markdown 编辑器仍是 callout | `> [!note]\n> type: strikeout\n> page: 1` |

![image-20261007170835784](./vx_images/image-20261007170835784.png)

## 安装

1. 安装  [typora-community-plugin/typora-community-plugin: Typora plugin system for enhancing your editing experience. | 增强 Typora 编辑体验的社区插件系统。](https://github.com/typora-community-plugin/typora-community-plugin)
2. 整个文件夹拷到 `~/.typora/community-plugins/plugins/callout-copy-button/`
3. 重启 Typora → 插件中心启用 "Callout Copy Button"（需已安装 [typora-plugin-core](https://github.com/typora-community-plugin/typora-plugin-core)）
4. 打开任意含 `> [!NOTE]` 的文档，悬停 alert 右上角出现按钮

设置入口：插件中心 → Callout Copy Button → 三个开关，改动即时生效（无需重启、无需重新打开文档）。

## 文件结构

```
callout-copy-button/
├── main.js        # 全部逻辑（单文件，ESM，约 380 行）
├── manifest.json  # tcp 插件清单
├── style.css      # 按钮定位与 P/M 字母样式（core 自动加载，名字不能改）
```

