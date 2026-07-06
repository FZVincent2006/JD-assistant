---
name: jd-skill
description: Use when the user provides a JD image, screenshot, poster, long image, or pasted OCR text and wants it converted into a recruiting JD text block compatible with the local JD publishing assistant plugin.
---

# JD Skill

## Purpose

Convert a job-description image into one clean long-form JD text block that can be copied directly into the existing JD publishing assistant plugin.

## Output Contract

When the user asks to parse, extract, convert, or organize a JD image, output only this template:

```text
公司：<公司名或待补充>
<岗位名称>｜<城市或base待定>｜<Full Time/社招/实习/待补充>

工作内容：
- ...

职位要求：
- ...

加分项：
- ...
```

Do not output JSON, markdown tables, scattered fields, analysis notes, confidence scores, or plugin instructions unless the user explicitly asks for them.

## Extraction Rules

- Read the title, subtitle, headers, body text, and small-print details in the image.
- Infer company from explicit labels such as `公司：`, brand names, email domains, intro paragraphs, or sender context. If uncertain, write `公司：待补充`.
- Infer job title from the largest title or role-like phrase.
- Infer city/base from subtitle or body phrases such as `上海`, `北京`, `深圳`, `base`, `地点`, `工作地点`. If unclear, write `base待定`.
- Infer hiring type from phrases such as `全职`, `Full Time`, `社招`, `实习`, `校招`. Prefer preserving the source wording if it is already clear.
- Remove emoji, decorative icons, visual bullets, contact-only lines, and layout artifacts.
- Preserve experience, education, salary, and work mode requirements inside the relevant bullet text. Do not split them into separate fields.
- Never invent missing information. Use `待补充` for unknown company or hiring type, and `base待定` for unknown location.

## Section Mapping

Normalize common headings into the fixed template:

| Source heading examples | Output section |
| --- | --- |
| `你将负责`, `工作内容`, `岗位职责`, `职责`, `Responsibilities`, `What you will do` | `工作内容` |
| `我们希望你`, `职位要求`, `任职要求`, `岗位要求`, `Requirements`, `Who you are` | `职位要求` |
| `加分项`, `优先项`, `Bonus`, `Nice to have`, `Preferred` | `加分项` |

Company introductions such as `我们是谁`, `关于我们`, `公司介绍` are usually omitted because the plugin template has no company-introduction section. Only keep details from them if they are necessary to identify the company or role.

If a section is absent from the source, keep the section header and put one bullet:

```text
- 待补充
```

## Formatting Rules

- Use full-width vertical bars in the second line: `岗位名称｜城市｜招聘类型`.
- Use `Full Time` when the image says `全职` or `Full Time`; use `实习` for internships.
- Use plain hyphen bullets only: `- ...`.
- Keep punctuation clean and readable; normalize Chinese parentheses where natural.
- Preserve technical terms such as `Agent`, `UI/UX`, `Figma`, `Node.js`, `K8s`, `RTOS`.
- If OCR or image quality is ambiguous, include the best readable text and mark unreadable critical content as `待补充` instead of guessing.

## Example

Input image contains:
- Title: `设计负责人`
- Subtitle: `全职 - 上海`
- Company text: `Dotwise 正在探索...`
- Sections: `你将负责`, `我们希望你`, `加分项`

Output:

```text
公司：Dotwise
设计负责人｜上海｜Full Time

工作内容：
- 定义下一代 Human-Agent 协作体验
- 核心功能的 UI, UX 与动效设计
- 建立具有独特品质感的 Design System 与品牌体系

职位要求：
- 有顶级 Taste，想法多
- 擅长 System Design，能为复杂系统设计巧妙抽象心智
- 有 3 年以上的 UI/UX 经验
- 设计基本功扎实，能独立完成完整设计流程

加分项：
- 熟悉 Motion Design（AE, Rive 等）
- AI Native，熟悉 Vibe coding，有极客精神
- 主导过复杂交互产品（Figma、notion level）的设计
```
