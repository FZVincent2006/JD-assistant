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
});
