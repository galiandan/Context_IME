# Context IME 图标

0.1.2 的扩展列表/详情页图标：`media/icon.png`。原始分辨率 1254×1254，RGBA PNG，由内置 imagegen 工具生成并复制到工程，没有使用第三方素材。背景为深蓝圆角方块，青色和薄荷绿的代码括号包围浅色输入光标，呼应代码上下文与输入法。图形不限定某一种输入语言。

本次修改只接入 package.json 的 icon 和 VSIX 资源清单；状态栏继续使用 VS Code 原生的小图标。

生成使用的完整提示词：

> Create a finished square application icon for a VS Code extension named Context IME. Use case: logo-brand. Asset type: actual extension icon, not a mockup. Minimal, precise, bold geometric symbol: two balanced coding angle brackets, cyan left bracket and mint right bracket, surrounding one warm ivory vertical text insertion cursor. A subtle tiny square cap or dot on the cursor can evoke typing, but keep very simple, three main strokes/elements. Center the mark, with clear optical balance and generous breathing room, occupying about 65 percent of the square. Background is a deep midnight navy rounded square tile with restrained subtle tonal depth, corners rounded; outside the rounded tile transparent if available. Flat vector-like graphic edges, excellent readability at 32 and 48 pixels, polished modern developer tool identity. No letters, no words, no Chinese glyph, no keyboard drawing, no arrows, no sparkles, no watermark, no extra symbols, no surrounding scene, no perspective, no drop shadow outside the icon. Produce one final high-quality square PNG icon. Save the generated asset so it can be copied into the local project.
