import { describe, expect, it } from "vitest";
import { parseJd } from "../src/lib/jdParser.js";

describe("parseJd", () => {
  it("extracts core fields from a ZhenFund style JD", () => {
    const jd = `### （1）Agent全栈工程师｜上海&SF｜Full Time

工作内容：
- 打造下一代多模态Agent Runtime
- Eval, Sandbox, Memory 等核心 Infra

岗位要求：
一. 有3-5年以上经验，做过真实生产级Agent
- 熟悉 Typescript 与 Node.js

加分项：
- 做过 Evaluation / Benchmark / Observability`;

    expect(parseJd(jd)).toEqual({
      companyName: "",
      title: "Agent全栈工程师",
      cities: ["上海", "SF"],
      recruitmentType: "社招全职",
      jobType: "",
      experience: "3-5年",
      education: "本科及以上",
      salaryMinK: "",
      salaryMaxK: "",
      industry: "",
      keywords: ["Agent", "Runtime", "TypeScript", "Node.js"],
      highlights: "",
      location: "上海",
      email: "",
      description: [
        "Agent全栈工程师｜上海、SF｜薪资open talk",
        "",
        "【岗位职责】",
        "- 打造下一代多模态Agent Runtime",
        "- Eval, Sandbox, Memory 等核心 Infra",
        "",
        "【任职要求】",
        "一. 有3-5年以上经验，做过真实生产级Agent",
        "- 熟悉 Typescript 与 Node.js",
        "",
        "【加分项】",
        "- 做过 Evaluation / Benchmark / Observability"
      ].join("\n"),
      sections: {
        companyIntro: [],
        responsibilities: [
          "- 打造下一代多模态Agent Runtime",
          "- Eval, Sandbox, Memory 等核心 Infra"
        ],
        requirements: [
          "一. 有3-5年以上经验，做过真实生产级Agent",
          "- 熟悉 Typescript 与 Node.js"
        ],
        bonuses: ["- 做过 Evaluation / Benchmark / Observability"],
        benefits: []
      }
    });
  });

  it("maps internship and city fields from slash separated titles", () => {
    const jd = `（3）游戏数据分析师｜北京 / 成都 / 深圳 / 香港｜校招 / 实习

职位描述
负责游戏数据分析和增长实验。

任职要求
本科及以上，熟悉 SQL。`;

    const result = parseJd(jd);

    expect(result.title).toBe("游戏数据分析师");
    expect(result.cities).toEqual(["北京", "成都", "深圳", "香港"]);
    expect(result.recruitmentType).toBe("实习生招聘");
    expect(result.education).toBe("本科及以上");
    expect(result.location).toBe("北京");
  });

  it("defaults education to bachelor and parses optional salary when present", () => {
    const jd = `AI产品经理｜北京｜社招

岗位职责
- 负责 AI 产品设计

任职要求
- 3年以上产品经验
- 薪资 25-40K`;

    const result = parseJd(jd);

    expect(result.education).toBe("本科及以上");
    expect(result.salaryMinK).toBe("25");
    expect(result.salaryMaxK).toBe("40");
  });

  it("formats portfolio company titles with the ZhenFund prefix", () => {
    const jd = `【真格被投-Dotwise】Agent全栈工程师｜上海｜社招

岗位职责
- 构建 Agent Runtime`;

    const result = parseJd(jd);

    expect(result.companyName).toBe("Dotwise");
    expect(result.title).toBe("【真格被投-Dotwise】Agent全栈工程师");
    expect(result.description.startsWith("Agent全栈工程师｜上海｜薪资open talk")).toBe(true);
  });

  it("extracts company name from a company line and formats the title", () => {
    const jd = `公司：Dotwise
Agent全栈工程师｜上海｜社招

岗位职责
- 构建 Agent Runtime`;

    const result = parseJd(jd);

    expect(result.companyName).toBe("Dotwise");
    expect(result.title).toBe("【真格被投-Dotwise】Agent全栈工程师");
  });

  it("extracts company name from 公司名 line and keeps the next line as title", () => {
    const jd = `公司名：Dotwise
设计负责人｜上海&SF｜Full Time

一.工作内容
- 定义下一代Human-Agent协作体验

二.岗位要求
- 有3年以上的UI/UX经验`;

    const result = parseJd(jd);

    expect(result.companyName).toBe("Dotwise");
    expect(result.title).toBe("【真格被投-Dotwise】设计负责人");
    expect(result.cities).toEqual(["上海", "SF"]);
    expect(result.experience).toBe("3-5年");
  });

  it("maps single lower-bound experience requirements to Maimai ranges", () => {
    const jd = `公司：ONANA Robotics
嵌入式工程师｜上海｜Full Time

工作内容：
- 计算平台系统集成:基于NVIDIA Jetson或RK3588等核心计算模块，设计接口协议转换。

职位要求：
- 本科及以上学历，电子、自动化、计算机等相关专业，3年以上机器人或智能硬件底层开发经验。
- 精通C/C++，熟悉嵌入式Linux驱动框架与实时操作系统(RTOS)。`;

    const result = parseJd(jd);

    expect(result.companyName).toBe("ONANA Robotics");
    expect(result.title).toBe("【真格被投-ONANA Robotics】嵌入式工程师");
    expect(result.experience).toBe("3-5年");
    expect(result.education).toBe("本科及以上");
  });

  it("places company introduction after the description header when intro comes after JD sections", () => {
    const jd = `公司：Hyperknow
品牌实习生 Branding Intern｜北京｜Full Time

工作内容：
- 和团队一起赋予 Hyperknow 性格

岗位要求：
- 有审美，有 taste，有创意

加分项：
- 有运营公众号经验

公司介绍：Hyperknow是真格基金最年轻的被投团队，一家年轻、有理想、有创造力、有好产品、已有用户基础的 startup。
团队里的人：
- 有非常强的 ownership 和 agency
- 保持好奇心，学习能力强
公司官网：https://www.hyperknow.io/`;

    const result = parseJd(jd);

    expect(result.description).toBe([
      "品牌实习生 Branding Intern｜北京｜薪资open talk",
      "",
      "公司介绍：",
      "Hyperknow是真格基金最年轻的被投团队，一家年轻、有理想、有创造力、有好产品、已有用户基础的 startup。",
      "团队里的人：",
      "- 有非常强的 ownership 和 agency",
      "- 保持好奇心，学习能力强",
      "公司官网：https://www.hyperknow.io/",
      "",
      "【岗位职责】",
      "- 和团队一起赋予 Hyperknow 性格",
      "",
      "【任职要求】",
      "- 有审美，有 taste，有创意",
      "",
      "【加分项】",
      "- 有运营公众号经验"
    ].join("\n"));
    expect(result.sections.companyIntro).toEqual([
      "Hyperknow是真格基金最年轻的被投团队，一家年轻、有理想、有创造力、有好产品、已有用户基础的 startup。",
      "团队里的人：",
      "- 有非常强的 ownership 和 agency",
      "- 保持好奇心，学习能力强",
      "公司官网：https://www.hyperknow.io/"
    ]);
  });

  it("finds the title line when company introduction appears before the JD", () => {
    const jd = `公司：Hyperknow
关于我们
Hyperknow是真格基金最年轻的被投团队。
团队里的人：
- 年轻，有活力，有理想
公司官网：https://www.hyperknow.io/

品牌实习生 Branding Intern｜北京｜Full Time

工作内容：
- 和团队一起赋予 Hyperknow 性格

岗位要求：
- 英文熟练，沟通无障碍`;

    const result = parseJd(jd);

    expect(result.companyName).toBe("Hyperknow");
    expect(result.title).toBe("【真格被投-Hyperknow】品牌实习生 Branding Intern");
    expect(result.description).toBe([
      "品牌实习生 Branding Intern｜北京｜薪资open talk",
      "",
      "公司介绍：",
      "Hyperknow是真格基金最年轻的被投团队。",
      "团队里的人：",
      "- 年轻，有活力，有理想",
      "公司官网：https://www.hyperknow.io/",
      "",
      "【岗位职责】",
      "- 和团队一起赋予 Hyperknow 性格",
      "",
      "【任职要求】",
      "- 英文熟练，沟通无障碍"
    ].join("\n"));
  });

  it("keeps unlabeled company introduction paragraphs before the title in company intro", () => {
    const jd = `Hyperknow是真格基金最年轻的被投团队，一家年轻、有理想、有创造力、有好产品、已有用户基础的 startup，希望产出真正让观众、用户能够看到的内容。
团队里的人：
- “We don’t say ‘we can’t’ in startup” 有毅力，有决心，能够忍受失败，愿意探索未知领域，迎难而上
- 年轻，有活力，有理想，富有热情。为推动一家 startup 成长而感到兴奋
公司官网：https://www.hyperknow.io/

品牌实习生 Branding Intern  ｜北京&remote ｜实习
工作内容：
- 和团队一起赋予 Hyperknow 性格

职位要求：
- 英文熟练，沟通无障碍

加分项：
- 有运营公众号、海内外社媒账号的经验`;

    const result = parseJd(jd);

    expect(result.companyName).toBe("Hyperknow");
    expect(result.title).toBe("【真格被投-Hyperknow】品牌实习生 Branding Intern");
    expect(result.description).toBe([
      "品牌实习生 Branding Intern｜北京｜薪资open talk",
      "",
      "公司介绍：",
      "Hyperknow是真格基金最年轻的被投团队，一家年轻、有理想、有创造力、有好产品、已有用户基础的 startup，希望产出真正让观众、用户能够看到的内容。",
      "团队里的人：",
      "- “We don’t say ‘we can’t’ in startup” 有毅力，有决心，能够忍受失败，愿意探索未知领域，迎难而上",
      "- 年轻，有活力，有理想，富有热情。为推动一家 startup 成长而感到兴奋",
      "公司官网：https://www.hyperknow.io/",
      "",
      "【岗位职责】",
      "- 和团队一起赋予 Hyperknow 性格",
      "",
      "【任职要求】",
      "- 英文熟练，沟通无障碍",
      "",
      "【加分项】",
      "- 有运营公众号、海内外社媒账号的经验"
    ].join("\n"));
    expect(result.sections.responsibilities).toEqual(["- 和团队一起赋予 Hyperknow 性格"]);
  });

  it("infers a Chinese company name from unlabeled company introduction", () => {
    const jd = `智子芯元是一家专注于 AI 计算加速的初创公司，正在打造面向 GPGPU、NPU 等异构芯片的 Agent 系统。
核心团队来自清华大学、北京大学、香港中文大学等学府，且行业经验丰富。
公司官网：https://kernelcat.cn/

Agent Harness 工程师｜深圳｜社招
核心职责
1. Agent Runtime 维护与演进

任职要求
1. 计算机、软件工程、电子、数学等相关专业本科及以上，3 年以上系统工程经验。`;

    const result = parseJd(jd);

    expect(result.companyName).toBe("智子芯元");
    expect(result.title).toBe("【真格被投-智子芯元】Agent Harness 工程师");
    expect(result.description).toContain("智子芯元是一家专注于 AI 计算加速的初创公司");
  });

  it("normalizes compatibility Chinese characters before inferring company and title", () => {
    const jd = `智子芯元是⼀家专注于 AI 计算加速的初创公司，正在打造⾯向 GPGPU、NPU 等异构芯⽚的 Agent 系统。
公司官网：https://kernelcat.cn/

Agent Harness ⼯程师｜深圳｜社招
核⼼职责
1. Agent Runtime 维护与演进`;

    const result = parseJd(jd);

    expect(result.companyName).toBe("智子芯元");
    expect(result.title).toBe("【真格被投-智子芯元】Agent Harness 工程师");
    expect(result.description).toContain("Agent Harness 工程师｜深圳｜薪资open talk");
  });
});
