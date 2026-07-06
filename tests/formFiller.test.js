// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { fillRecruitingForm } from "../src/content/formFiller.js";

describe("fillBossForm", () => {
  it("uses the explicitly selected platform instead of auto detection", async () => {
    document.body.innerHTML = `
      <main>
        <input placeholder="请输入职位名称" />
        <textarea placeholder="请输入岗位职责、任职要求等"></textarea>
      </main>
    `;

    const result = await fillRecruitingForm(
      {
        title: "Agent工程师",
        description: "负责 Agent 产品工程"
      },
      document,
      { platform: "maimai", settleMs: 0, fieldDelayMs: 0 }
    );

    expect(result.platform).toBe("maimai");
    expect(document.querySelector("input").value).toBe("Agent工程师");
    expect(document.querySelector("textarea").value).toBe("负责 Agent 产品工程");
  });

  it("fills required text fields and clicks matching recruitment type", async () => {
    document.body.innerHTML = `
      <div>
        <label>招聘类型</label>
        <button>社招全职</button>
        <button>应届校园招聘</button>
        <button>实习生招聘</button>
        <label>职位名称</label>
        <input placeholder="请填写职位名称，如“销售专员”" />
        <label>职位描述</label>
        <textarea placeholder="请勿填写QQ、微信"></textarea>
        <label>工作地址</label>
        <input value="上海 上海市" />
      </div>
    `;
    const inputSpy = vi.fn();
    document.querySelector("input").addEventListener("input", inputSpy);

    const result = await fillRecruitingForm({
      recruitmentType: "实习生招聘",
      title: "Agent工程师",
      description: "岗位职责\n- 构建 Agent Runtime",
      location: "深圳"
    });

    expect(result.filled).toEqual(["recruitmentType", "title", "description", "location"]);
    expect(document.querySelector("button:nth-of-type(3)").dataset.bossAssistantSelected).toBe("true");
    expect(document.querySelector("input").value).toBe("Agent工程师");
    expect(document.querySelector("textarea").value).toContain("构建 Agent Runtime");
    expect(document.querySelectorAll("input")[1].value).toBe("深圳深圳市");
    expect(inputSpy).toHaveBeenCalled();
  });

  it("reports missing fields without throwing", async () => {
    document.body.innerHTML = `<main><input placeholder="职位名称" /></main>`;

    const result = await fillRecruitingForm({
      title: "产品经理",
      description: "负责产品规划",
      recruitmentType: "社招全职",
      location: "北京"
    });

    expect(result.filled).toEqual(["title"]);
    expect(result.missing).toEqual(["recruitmentType", "description", "location"]);
  });

  it("treats Boss default social recruitment type as satisfied when the picker is not clickable", async () => {
    document.body.innerHTML = `
      <main>
        <h2>职位基本信息</h2>
        <p>职位发布成功后，招聘类型、职位名称、职位类型、工作城市，将无法修改</p>
        <label>职位名称</label>
        <input placeholder="职位名称" />
        <label>职位描述</label>
        <textarea></textarea>
        <label>工作地址</label>
        <input placeholder="工作地址" />
      </main>
    `;

    const result = await fillRecruitingForm(
      { recruitmentType: "社招全职", title: "Agent工程师", description: "负责 Agent 产品", location: "上海" },
      document,
      { platform: "boss", settleMs: 0, fieldDelayMs: 0 }
    );

    expect(result.filled).toEqual(["recruitmentType", "title", "description", "location"]);
    expect(result.missing).toEqual([]);
  });

  it("still reports non-default Boss recruitment types when no picker is clickable", async () => {
    document.body.innerHTML = `
      <main>
        <h2>职位基本信息</h2>
        <p>职位发布成功后，招聘类型、职位名称、职位类型、工作城市，将无法修改</p>
        <label>职位名称</label>
        <input placeholder="职位名称" />
        <label>职位描述</label>
        <textarea></textarea>
        <label>工作地址</label>
        <input placeholder="工作地址" />
      </main>
    `;

    const result = await fillRecruitingForm(
      { recruitmentType: "实习生招聘", title: "Agent工程师", description: "负责 Agent 产品", location: "上海" },
      document,
      { platform: "boss", settleMs: 0, fieldDelayMs: 0 }
    );

    expect(result.filled).toEqual(["title", "description", "location"]);
    expect(result.missing).toEqual(["recruitmentType"]);
  });

  it("fills requirement fields when editable controls are present", async () => {
    document.body.innerHTML = `
      <div>
        <label>经验</label>
        <input placeholder="经验要求" />
        <label>学历</label>
        <input placeholder="最低学历" />
        <label>薪资范围</label>
        <input placeholder="最低月薪" />
        <input placeholder="最高月薪" />
        <label>职位关键词</label>
        <input placeholder="请输入关键词" />
      </div>
    `;

    const result = await fillRecruitingForm({
      experience: "3-5年",
      education: "本科",
      salaryMinK: "20",
      salaryMaxK: "35",
      keywords: ["Agent", "Runtime"]
    });

    expect(result.filled).toEqual(["experience", "education", "salary", "keywords"]);
    expect(document.querySelector("[placeholder='经验要求']").value).toBe("3-5年");
    expect(document.querySelector("[placeholder='最低学历']").value).toBe("本科");
    expect(document.querySelector("[placeholder='最低月薪']").value).toBe("20");
    expect(document.querySelector("[placeholder='最高月薪']").value).toBe("35");
    expect(document.querySelector("[placeholder='请输入关键词']").value).toBe("Agent、Runtime");
  });

  it("opens Boss select-like inputs instead of writing values directly", async () => {
    const events = [];
    document.body.innerHTML = `
      <section>
        <div><span>经验</span><input placeholder="请选择经验要求" /></div>
        <div class="experience-popup" style="display: none"><div>3-5年</div></div>
        <div><span>学历</span><input placeholder="请选择最低学历" /></div>
        <div class="education-popup" style="display: none"><div>本科</div></div>
      </section>
    `;
    document.querySelector("[placeholder='请选择经验要求']").addEventListener("click", () => {
      events.push("open-experience");
      document.querySelector(".experience-popup").style.display = "block";
    });
    document.querySelector("[placeholder='请选择最低学历']").addEventListener("click", () => {
      events.push("open-education");
      document.querySelector(".education-popup").style.display = "block";
    });
    textButton("3-5年").addEventListener("click", () => events.push("select-experience"));
    textButton("本科").addEventListener("click", () => events.push("select-education"));

    const result = await fillRecruitingForm(
      { experience: "3-5年", education: "本科及以上" },
      document,
      { platform: "boss", settleMs: 0, fieldDelayMs: 0, optionTimeoutMs: 80, optionPollMs: 10 }
    );

    expect(result.filled).toEqual(["experience", "education"]);
    expect(events).toEqual(["open-experience", "select-experience", "open-education", "select-education"]);
    expect(document.querySelector("[placeholder='请选择经验要求']").value).toBe("");
    expect(document.querySelector("[placeholder='请选择最低学历']").value).toBe("");
  });

  it("clicks Boss select boxes that wrap an input and arrow icon", async () => {
    const events = [];
    document.body.innerHTML = `
      <section>
        <div class="boss-row"><span>经验</span><div class="boss-select-box"><input placeholder="请选择经验要求" /><i>⌄</i></div></div>
        <div class="experience-popup" style="display: none"><div>3-5年</div></div>
        <div class="boss-row"><span>学历</span><div class="boss-select-box"><input placeholder="请选择最低学历" /><i>⌄</i></div></div>
        <div class="education-popup" style="display: none"><div>本科</div></div>
      </section>
    `;
    const boxes = document.querySelectorAll(".boss-select-box");
    boxes[0].addEventListener("mousedown", (event) => {
      if (event.target !== event.currentTarget) return;
      events.push("open-experience-box");
      document.querySelector(".experience-popup").style.display = "block";
    });
    boxes[1].addEventListener("mousedown", (event) => {
      if (event.target !== event.currentTarget) return;
      events.push("open-education-box");
      document.querySelector(".education-popup").style.display = "block";
    });
    textButton("3-5年").addEventListener("click", () => events.push("select-experience"));
    textButton("本科").addEventListener("click", () => events.push("select-education"));

    const result = await fillRecruitingForm(
      { experience: "3-5年", education: "本科及以上" },
      document,
      { platform: "boss", settleMs: 0, fieldDelayMs: 0, optionTimeoutMs: 80, optionPollMs: 10 }
    );

    expect(result.filled).toEqual(["experience", "education"]);
    expect(events).toEqual(["open-experience-box", "select-experience", "open-education-box", "select-education"]);
  });

  it("clicks unclassed Boss select boxes that wrap an input and arrow icon", async () => {
    const events = [];
    document.body.innerHTML = `
      <section>
        <div class="boss-row"><span>经验</span><div><input placeholder="请选择经验要求" /><i>⌄</i></div></div>
        <div class="experience-popup" style="display: none"><div>3-5年</div></div>
        <div class="boss-row"><span>学历</span><div><input placeholder="请选择最低学历" /><i>⌄</i></div></div>
        <div class="education-popup" style="display: none"><div>本科</div></div>
      </section>
    `;
    const boxes = document.querySelectorAll(".boss-row > div");
    boxes[0].addEventListener("mousedown", (event) => {
      if (event.target !== event.currentTarget) return;
      events.push("open-experience-box");
      document.querySelector(".experience-popup").style.display = "block";
    });
    boxes[1].addEventListener("mousedown", (event) => {
      if (event.target !== event.currentTarget) return;
      events.push("open-education-box");
      document.querySelector(".education-popup").style.display = "block";
    });
    textButton("3-5年").addEventListener("click", () => events.push("select-experience"));
    textButton("本科").addEventListener("click", () => events.push("select-education"));

    const result = await fillRecruitingForm(
      { experience: "3-5年", education: "本科及以上" },
      document,
      { platform: "boss", settleMs: 0, fieldDelayMs: 0, optionTimeoutMs: 80, optionPollMs: 10 }
    );

    expect(result.filled).toEqual(["experience", "education"]);
    expect(events).toEqual(["open-experience-box", "select-experience", "open-education-box", "select-education"]);
  });

  it("falls back to the arrow icon inside Boss requirement selects", async () => {
    const events = [];
    document.body.innerHTML = `
      <section>
        <div class="boss-row"><span>经验</span><div><input placeholder="请选择经验要求" /><i data-kind="experience-arrow">⌄</i></div></div>
        <div class="experience-popup" style="display: none"><div>3-5年</div></div>
        <div class="boss-row"><span>学历</span><div><input placeholder="请选择最低学历" /><i data-kind="education-arrow">⌄</i></div></div>
        <div class="education-popup" style="display: none"><div>本科</div></div>
      </section>
    `;
    document.querySelector("[data-kind='experience-arrow']").addEventListener("mousedown", () => {
      events.push("open-experience-arrow");
      document.querySelector(".experience-popup").style.display = "block";
    });
    document.querySelector("[data-kind='education-arrow']").addEventListener("mousedown", () => {
      events.push("open-education-arrow");
      document.querySelector(".education-popup").style.display = "block";
    });
    textButton("3-5年").addEventListener("click", () => events.push("select-experience"));
    textButton("本科").addEventListener("click", () => events.push("select-education"));

    const result = await fillRecruitingForm(
      { experience: "3-5年", education: "本科及以上" },
      document,
      { platform: "boss", settleMs: 0, fieldDelayMs: 0, optionTimeoutMs: 80, optionPollMs: 10 }
    );

    expect(result.filled).toEqual(["experience", "education"]);
    expect(events).toEqual(["open-experience-arrow", "select-experience", "open-education-arrow", "select-education"]);
  });

  it("clicks the inner Boss input wrapper for experience and education selects", async () => {
    const events = [];
    document.body.innerHTML = `
      <section>
        <div class="boss-field-row">
          <span>经验</span>
          <div class="boss-control">
            <div class="input-wrap"><input placeholder="请选择经验要求" /></div>
            <i>⌄</i>
          </div>
        </div>
        <div class="experience-popup" style="display: none"><div>3-5年</div></div>
        <div class="boss-field-row">
          <span>学历</span>
          <div class="boss-control">
            <div class="input-wrap"><input placeholder="请选择最低学历" /></div>
            <i>⌄</i>
          </div>
        </div>
        <div class="education-popup" style="display: none"><div>本科</div></div>
      </section>
    `;
    document.querySelectorAll(".input-wrap")[0].addEventListener("mousedown", (event) => {
      if (event.target !== event.currentTarget) return;
      events.push("open-experience-inner");
      document.querySelector(".experience-popup").style.display = "block";
    });
    document.querySelectorAll(".input-wrap")[1].addEventListener("mousedown", (event) => {
      if (event.target !== event.currentTarget) return;
      events.push("open-education-inner");
      document.querySelector(".education-popup").style.display = "block";
    });
    document.querySelectorAll(".boss-control")[0].addEventListener("mousedown", (event) => {
      if (event.target !== event.currentTarget) return;
      events.push("wrong-experience-outer");
    });
    document.querySelectorAll(".boss-control")[1].addEventListener("mousedown", (event) => {
      if (event.target !== event.currentTarget) return;
      events.push("wrong-education-outer");
    });
    textButton("3-5年").addEventListener("click", () => events.push("select-experience"));
    textButton("本科").addEventListener("click", () => events.push("select-education"));

    const result = await fillRecruitingForm(
      { experience: "3-5年", education: "本科及以上" },
      document,
      { platform: "boss", settleMs: 0, fieldDelayMs: 0, optionTimeoutMs: 80, optionPollMs: 10 }
    );

    expect(result.filled).toEqual(["experience", "education"]);
    expect(events).toEqual(["open-experience-inner", "select-experience", "open-education-inner", "select-education"]);
  });

  it("retries Boss requirement selects on the right arrow side when center clicks do not open", async () => {
    const events = [];
    document.body.innerHTML = `
      <section>
        <div class="boss-field-row">
          <span>经验</span>
          <div class="boss-control"><input placeholder="请选择经验要求" /></div>
        </div>
        <div class="experience-popup" style="display: none"><div>3-5年</div></div>
        <div class="boss-field-row">
          <span>学历</span>
          <div class="boss-control"><input placeholder="请选择最低学历" /></div>
        </div>
        <div class="education-popup" style="display: none"><div>本科</div></div>
      </section>
    `;
    const boxes = document.querySelectorAll(".boss-control");
    boxes.forEach((box, index) => {
      box.getBoundingClientRect = () => ({
        left: 100,
        top: index * 80,
        width: 300,
        height: 40,
        right: 400,
        bottom: index * 80 + 40
      });
    });
    boxes[0].addEventListener("mousedown", (event) => {
      if (event.clientX < 325) return;
      events.push("open-experience-right");
      document.querySelector(".experience-popup").style.display = "block";
    });
    boxes[1].addEventListener("mousedown", (event) => {
      if (event.clientX < 325) return;
      events.push("open-education-right");
      document.querySelector(".education-popup").style.display = "block";
    });
    textButton("3-5年").addEventListener("click", () => events.push("select-experience"));
    textButton("本科").addEventListener("click", () => events.push("select-education"));

    const result = await fillRecruitingForm(
      { experience: "3-5年", education: "本科及以上" },
      document,
      { platform: "boss", settleMs: 0, fieldDelayMs: 0, optionTimeoutMs: 80, optionPollMs: 10 }
    );

    expect(result.filled).toEqual(["experience", "education"]);
    expect(events).toEqual(["open-experience-right", "select-experience", "open-education-right", "select-education"]);
  });

  it("uses Boss requirements rows instead of earlier publish inputs with similar classes", async () => {
    const events = [];
    document.body.innerHTML = `
      <section>
        <div class="base-info-content">
          <div class="publish-component">
            <div class="publish-edit-form-row job-position-container">
              <div class="publish-title">职位类型</div>
              <div class="publish-content"><div class="ipt-wrap"><input class="ipt" readonly placeholder="选择职位类型" /></div></div>
            </div>
          </div>
        </div>
        <div class="requirements-info-content">
          <div class="publish-component">
            <div class="publish-edit-form-row">
              <div class="publish-title">经验</div>
              <div class="publish-content"><div class="ipt-wrap"><input class="ipt" readonly placeholder="请选择经验要求" /></div></div>
            </div>
          </div>
          <div class="experience-popup" style="display: none"><div>3-5年</div></div>
          <div class="publish-component">
            <div class="publish-edit-form-row">
              <div class="publish-title">学历</div>
              <div class="publish-content"><div class="ipt-wrap"><input class="ipt" readonly placeholder="请选择最低学历" /></div></div>
            </div>
          </div>
          <div class="education-popup" style="display: none"><div>本科</div></div>
        </div>
      </section>
    `;
    document.querySelector("[placeholder='选择职位类型']").addEventListener("mousedown", () => {
      events.push("wrong-job-type");
    });
    document.querySelector("[placeholder='请选择经验要求']").addEventListener("mousedown", () => {
      events.push("open-experience-input");
      document.querySelector(".experience-popup").style.display = "block";
    });
    document.querySelector("[placeholder='请选择最低学历']").addEventListener("mousedown", () => {
      events.push("open-education-input");
      document.querySelector(".education-popup").style.display = "block";
    });
    textButton("3-5年").addEventListener("click", () => events.push("select-experience"));
    textButton("本科").addEventListener("click", () => events.push("select-education"));

    const result = await fillRecruitingForm(
      { experience: "3-5年", education: "本科及以上" },
      document,
      { platform: "boss", settleMs: 0, fieldDelayMs: 0, optionTimeoutMs: 80, optionPollMs: 10 }
    );

    expect(result.filled).toEqual(["experience", "education"]);
    expect(events).toEqual(["open-experience-input", "select-experience", "open-education-input", "select-education"]);
  });

  it("ignores zero-size Boss option text until the select is actually opened", async () => {
    const events = [];
    document.body.innerHTML = `
      <section>
        <div class="requirements-info-content">
          <div class="publish-component">
            <div class="publish-edit-form-row">
              <div class="publish-title">经验</div>
              <div class="publish-content"><div class="ipt-wrap"><input class="ipt" readonly placeholder="请选择经验要求" /></div></div>
            </div>
          </div>
          <div class="hidden-options"><div>3-5年</div></div>
          <div class="experience-popup" style="display: none"><div>3-5年</div></div>
        </div>
      </section>
    `;
    document.querySelector(".hidden-options div").getBoundingClientRect = () => ({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 0,
      bottom: 0,
      width: 0,
      height: 0
    });
    document.querySelector("[placeholder='请选择经验要求']").addEventListener("mousedown", () => {
      events.push("open-experience-input");
      document.querySelector(".experience-popup").style.display = "block";
    });
    document.querySelector(".hidden-options div").addEventListener("click", () => events.push("wrong-hidden-option"));
    document.querySelector(".experience-popup div").addEventListener("click", () => events.push("select-visible-experience"));

    const result = await fillRecruitingForm(
      { experience: "3-5年" },
      document,
      { platform: "boss", settleMs: 0, fieldDelayMs: 0, optionTimeoutMs: 80, optionPollMs: 10 }
    );

    expect(result.filled).toEqual(["experience"]);
    expect(events).toEqual(["open-experience-input", "select-visible-experience"]);
  });

  it("ignores Boss ui-select items until their select has the visible state", async () => {
    const events = [];
    document.body.innerHTML = `
      <section>
        <div class="requirements-info-content">
          <div class="publish-component">
            <div class="publish-edit-form-row">
              <div class="publish-title">经验</div>
              <div class="publish-content">
                <div class="small experience-select ui-select ui-select-single">
                  <div class="ui-select-selection">
                    <div class="ui-select-inner"><span class="ui-select-placeholder">请选择经验要求</span></div>
                  </div>
                  <div class="ui-select-dropdown">
                    <ul class="ui-dropdown-list"><li class="ui-select-item">3-5年</li></ul>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>
    `;
    const select = document.querySelector(".ui-select");
    const option = document.querySelector(".ui-select-item");
    option.getBoundingClientRect = () => ({
      x: 210,
      y: 340,
      left: 210,
      top: 340,
      right: 330,
      bottom: 374,
      width: 120,
      height: 34
    });
    document.querySelector(".ui-select-placeholder").addEventListener("mousedown", () => {
      events.push("open-ui-select");
      select.classList.add("ui-select-visible");
    });
    option.addEventListener("click", () => {
      events.push(select.classList.contains("ui-select-visible") ? "select-visible-option" : "wrong-hidden-option");
    });

    const result = await fillRecruitingForm(
      { experience: "3-5年" },
      document,
      { platform: "boss", settleMs: 0, fieldDelayMs: 0, optionTimeoutMs: 80, optionPollMs: 10 }
    );

    expect(result.filled).toEqual(["experience"]);
    expect(events).toEqual(["open-ui-select", "select-visible-option"]);
  });

  it("does not write Boss ui-select internal search inputs instead of opening the dropdown", async () => {
    const events = [];
    document.body.innerHTML = `
      <section>
        <div class="requirements-info-content">
          <div class="publish-component">
            <div class="publish-edit-form-row">
              <div class="publish-title">经验</div>
              <div class="publish-content">
                <div class="small experience-select ui-select ui-select-single">
                  <input class="ui-select-search-input" />
                  <div class="ui-select-selection">
                    <div class="ui-select-inner"><span class="ui-select-placeholder">请选择经验要求</span></div>
                  </div>
                  <div class="ui-select-dropdown">
                    <ul class="ui-dropdown-list"><li class="ui-select-item">3-5年</li></ul>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>
    `;
    const select = document.querySelector(".ui-select");
    const searchInput = document.querySelector(".ui-select-search-input");
    const option = document.querySelector(".ui-select-item");
    option.getBoundingClientRect = () => ({
      x: 210,
      y: 340,
      left: 210,
      top: 340,
      right: 330,
      bottom: 374,
      width: 120,
      height: 34
    });
    document.querySelector(".ui-select-placeholder").addEventListener("mousedown", () => {
      events.push("open-ui-select");
      select.classList.add("ui-select-visible");
    });
    option.addEventListener("click", () => {
      events.push("select-visible-option");
    });

    const result = await fillRecruitingForm(
      { experience: "3-5年" },
      document,
      { platform: "boss", settleMs: 0, fieldDelayMs: 0, optionTimeoutMs: 80, optionPollMs: 10 }
    );

    expect(result.filled).toEqual(["experience"]);
    expect(searchInput.value).toBe("");
    expect(events).toEqual(["open-ui-select", "select-visible-option"]);
  });

  it("clicks Boss recruitment type rendered as custom div buttons", async () => {
    document.body.innerHTML = `
      <section>
        <div><span>招聘类型</span><div>社招全职</div><div>实习生招聘</div></div>
      </section>
    `;

    const result = await fillRecruitingForm(
      { recruitmentType: "社招全职" },
      document,
      { platform: "boss", settleMs: 0, fieldDelayMs: 0 }
    );

    expect(result.filled).toEqual(["recruitmentType"]);
    expect(textButton("社招全职").dataset.bossAssistantSelected).toBe("true");
  });

  it("fills Boss custom dropdowns in publish-page order and scrolls education options", async () => {
    const events = [];
    document.body.innerHTML = `
      <section>
        <div><span>招聘类型</span><button>社招全职</button><button>实习生招聘</button></div>
        <div><span>职位名称</span><input placeholder="请填写职位名称，如“销售专员”" /></div>
        <div><span>职位描述</span><textarea placeholder="请勿填写QQ、微信"></textarea></div>
        <div><span>是否驻外</span><button>长期驻境外</button><button>短期境外出差</button><button>境内岗位</button></div>
        <div><span>经验</span><div role="button">请选择经验要求</div></div>
        <div class="experience-popup" style="display: none"><div>不限</div><div>1年以内</div><div>1-3年</div><div>3-5年</div><div>5-10年</div></div>
        <div><span>学历</span><div role="button">请选择最低学历</div></div>
        <div class="education-popup" style="display: none; overflow: auto; max-height: 120px">
          <div>不限</div>
          <div>初中及以下</div>
          <div>中专/中技</div>
          <div>高中</div>
          <div>大专</div>
        </div>
        <div><span>薪资范围</span><div role="button">最低月薪</div><div role="button">最高月薪</div></div>
        <div class="min-salary-popup" style="display: none"><div>20K</div></div>
        <div class="max-salary-popup" style="display: none"><div>35K</div></div>
        <div><span>工作地址</span><input value="上海上海市" /></div>
      </section>
    `;

    textButton("请选择经验要求").addEventListener("click", () => {
      events.push("open-experience");
      document.querySelector(".experience-popup").style.display = "block";
    });
    textButton("请选择最低学历").addEventListener("click", () => {
      events.push("open-education");
      document.querySelector(".education-popup").style.display = "block";
    });
    document.querySelector(".education-popup").addEventListener("scroll", () => {
      if (!textButton("本科")) {
        const option = document.createElement("div");
        option.textContent = "本科";
        option.addEventListener("click", () => events.push("select-education"));
        document.querySelector(".education-popup").append(option);
      }
    });
    textButton("最低月薪").addEventListener("click", () => {
      events.push("open-min-salary");
      document.querySelector(".min-salary-popup").style.display = "block";
    });
    textButton("最高月薪").addEventListener("click", () => {
      events.push("open-max-salary");
      document.querySelector(".max-salary-popup").style.display = "block";
    });
    textButton("3-5年").addEventListener("click", () => events.push("select-experience"));
    textButton("20K").addEventListener("click", () => events.push("select-min-salary"));
    textButton("35K").addEventListener("click", () => events.push("select-max-salary"));

    const result = await fillRecruitingForm(
      {
        companyName: "Dotwise",
        recruitmentType: "社招全职",
        title: "Agent 全栈工程师",
        description: "Agent 全栈工程师｜上海｜薪资open talk\n\n【岗位职责】\n- 构建 Agent Runtime",
        experience: "3-5年",
        education: "本科及以上",
        salaryMinK: "20",
        salaryMaxK: "35",
        location: "上海"
      },
      document,
      { platform: "boss", settleMs: 0, fieldDelayMs: 0, optionTimeoutMs: 80, optionPollMs: 10 }
    );

    expect(result.filled).toEqual([
      "recruitmentType",
      "title",
      "description",
      "experience",
      "education",
      "salary",
      "location",
      "jobAttribute"
    ]);
    expect(document.querySelector("[placeholder='请填写职位名称，如“销售专员”']").value).toBe("【真格被投-Dotwise】Agent 全栈工程师");
    expect(document.querySelector("textarea").value).toContain("Agent 全栈工程师｜上海｜薪资open talk");
    expect(textButton("境内岗位").dataset.bossAssistantSelected).toBe("true");
    expect(textButton("请选择经验要求").dataset.recruitingAssistantValue).toBe("3-5年");
    expect(textButton("本科").dataset.recruitingAssistantSelected).toBe("true");
    expect(textButton("最低月薪").dataset.recruitingAssistantValue).toBe("20K");
    expect(textButton("最高月薪").dataset.recruitingAssistantValue).toBe("35K");
    expect(document.querySelectorAll("input")[1].value).toBe("上海上海市");
    expect(events).toEqual([
      "open-experience",
      "select-experience",
      "open-education",
      "select-education",
      "open-min-salary",
      "select-min-salary",
      "open-max-salary",
      "select-max-salary"
    ]);
  });

  it("fills Maimai publish page fields from labels and placeholders", async () => {
    document.body.innerHTML = `
      <section>
        <div><span>* 公司名称</span><input value="真格基金" disabled /></div>
        <div><span>* 职位名称</span><input placeholder="请输入职位名称" /></div>
        <div><span>* 职位描述</span><textarea placeholder="请输入岗位职责、任职要求等"></textarea></div>
        <div><span>* 经验学历</span><div role="button">请选择工作经验要求</div><div role="button">请选择学历要求</div></div>
        <div class="experience-popup" style="display: none"><div role="option">3–5年</div></div>
        <div class="education-popup" style="display: none"><div role="option">本科及以上</div></div>
        <div><span>* 薪资范围</span><div role="button">最低</div></div>
        <div><span>* 行业要求</span><div role="button">选择对候选人的行业要求，推送更准确</div></div>
        <div class="industry-modal" style="display: none">
          <div role="option">不限行业</div>
          <button>确定</button>
        </div>
        <div><span>职位关键词</span><div role="button">请先选择「职位类别」</div></div>
        <div><span>职位亮点</span><div role="button">选择职位亮点，让职位更有吸引力</div></div>
        <div><span>* 邮箱地址</span><input value="recruiting@zhenfund.com" /></div>
        <div><span>* 职位属性</span><button>金牌职位</button><button>普通职位</button></div>
      </section>
    `;

    textButton("选择对候选人的行业要求，推送更准确").addEventListener("click", () => {
      document.querySelector(".industry-modal").style.display = "block";
    });
    textButton("请选择工作经验要求").addEventListener("click", () => {
      document.querySelector(".experience-popup").style.display = "block";
    });
    textButton("请选择学历要求").addEventListener("click", () => {
      document.querySelector(".education-popup").style.display = "block";
    });

    const result = await fillRecruitingForm(
      {
        title: "Agent工程师",
        description: "【岗位职责】\n- 构建 Agent Runtime",
        experience: "3-5年",
        education: "本科及以上",
        salaryMinK: "20",
        salaryMaxK: "35",
        keywords: ["Agent", "Runtime"],
        location: "北京"
      },
      document,
      { platform: "maimai", settleMs: 0, fieldDelayMs: 0 }
    );

    expect(result.platform).toBe("maimai");
    expect(result.filled).toEqual(["title", "description", "experience", "education", "salary", "industry", "jobAttribute"]);
    expect(document.querySelector("[placeholder='请输入职位名称']").value).toBe("Agent工程师");
    expect(document.querySelector("textarea").value).toContain("构建 Agent Runtime");
    expect(textButton("请选择工作经验要求").dataset.recruitingAssistantValue).toBe("3-5年");
    expect(textButton("请选择学历要求").dataset.recruitingAssistantValue).toBe("本科及以上");
    expect(document.querySelector(".experience-popup [role='option']").dataset.recruitingAssistantSelected).toBe("true");
    expect(document.querySelector(".education-popup [role='option']").dataset.recruitingAssistantSelected).toBe("true");
    expect(textButton("最低").dataset.recruitingAssistantValue).toBe("20-35K");
    expect(textButton("选择对候选人的行业要求，推送更准确").dataset.recruitingAssistantValue).toBe("不限行业");
    expect(textButton("请先选择「职位类别」").dataset.recruitingAssistantValue).toBeUndefined();
    expect(textButton("普通职位").dataset.recruitingAssistantSelected).toBe("true");
  });

  it("formats Maimai title with company prefix before filling", async () => {
    document.body.innerHTML = `
      <section>
        <div><span>* 职位名称</span><input placeholder="请输入职位名称" /></div>
      </section>
    `;

    const result = await fillRecruitingForm(
      { companyName: "Dotwise", title: "Agent全栈工程师" },
      document,
      { platform: "maimai", settleMs: 0, fieldDelayMs: 0 }
    );

    expect(result.filled).toEqual(["title"]);
    expect(document.querySelector("input").value).toBe("【真格被投-Dotwise】Agent全栈工程师");
  });

  it("does not click Maimai keywords or highlights", async () => {
    const events = [];
    document.body.innerHTML = `
      <section>
        <div><span>职位关键词</span><div role="button">请先选择「职位类别」</div></div>
        <div><span>职位亮点</span><div role="button">选择职位亮点，让职位更有吸引力</div></div>
      </section>
    `;
    textButton("请先选择「职位类别」").addEventListener("click", () => events.push("keywords"));
    textButton("选择职位亮点，让职位更有吸引力").addEventListener("click", () => events.push("highlights"));

    const result = await fillRecruitingForm(
      { keywords: ["Agent", "Runtime"], highlights: "技术前沿" },
      document,
      { platform: "maimai", settleMs: 0, fieldDelayMs: 0 }
    );

    expect(result.filled).toEqual([]);
    expect(events).toEqual([]);
    expect(textButton("请先选择「职位类别」").dataset.recruitingAssistantValue).toBeUndefined();
    expect(textButton("选择职位亮点，让职位更有吸引力").dataset.recruitingAssistantValue).toBeUndefined();
  });

  it("does not fill Maimai work location even when parsed", async () => {
    document.body.innerHTML = `
      <section>
        <div><span>* 工作地址</span><div role="button">上海-全部-上海</div></div>
      </section>
    `;

    const result = await fillRecruitingForm(
      { location: "北京" },
      document,
      { platform: "maimai", settleMs: 0, fieldDelayMs: 0 }
    );

    expect(result.filled).toEqual([]);
    expect(textButton("上海-全部-上海").dataset.recruitingAssistantValue).toBeUndefined();
  });

  it("waits between Maimai dropdown fields before opening the next one", async () => {
    const events = [];
    document.body.innerHTML = `
      <section>
        <div><span>* 经验学历</span><div role="button">请选择工作经验要求</div><div role="button">请选择学历要求</div></div>
        <div class="experience-popup" style="display: none"><div role="option">3–5年</div></div>
        <div class="education-popup" style="display: none"><div role="option">本科及以上</div></div>
      </section>
    `;
    textButton("请选择工作经验要求").addEventListener("click", () => {
      events.push("open-experience");
      document.querySelector(".experience-popup").style.display = "block";
    });
    textButton("请选择学历要求").addEventListener("click", () => {
      events.push(`open-education-after-${events.at(-1)}`);
      document.querySelector(".education-popup").style.display = "block";
    });
    document.querySelector(".experience-popup [role='option']").addEventListener("click", () => {
      events.push("select-experience");
      document.querySelector(".experience-popup").style.display = "none";
    });

    await fillRecruitingForm(
      { experience: "3-5年", education: "本科及以上" },
      document,
      { platform: "maimai", settleMs: 0, fieldDelayMs: 0 }
    );

    expect(events).toEqual(["open-experience", "select-experience", "open-education-after-select-experience"]);
  });

  it("opens a Maimai custom select and clicks a matching popup option with dash variants", async () => {
    document.body.innerHTML = `
      <section>
        <div><span>* 经验学历</span><div role="button">请选择工作经验要求</div></div>
        <div class="popup" style="display: none">
          <div role="option">1年以内</div>
          <div role="option">3–5年</div>
          <div role="option">5-10年</div>
        </div>
      </section>
    `;
    const trigger = textButton("请选择工作经验要求");
    trigger.addEventListener("click", () => {
      document.querySelector(".popup").style.display = "block";
    });

    const result = await fillRecruitingForm(
      { experience: "3-5年" },
      document,
      { platform: "maimai", settleMs: 0 }
    );

    expect(result.filled).toEqual(["experience"]);
    expect(document.querySelector("[role='option']:nth-child(2)").dataset.recruitingAssistantSelected).toBe("true");
  });

  it("opens Maimai experience and education inputs by placeholder and selects plain options", async () => {
    const events = [];
    document.body.innerHTML = `
      <section>
        <div><span>* 经验学历</span><input readonly placeholder="请选择工作经验要求" /><input readonly placeholder="请选择学历要求" /></div>
        <div class="experience-popup" style="display: none">
          <div>1年以内</div>
          <div>1–3年</div>
          <div>3–5年</div>
          <div>5–10年</div>
          <div>10年以上</div>
          <div>经验不限</div>
        </div>
        <div class="education-popup" style="display: none">
          <div>学历不限</div>
          <div>本科及以上</div>
          <div>硕士及以上</div>
          <div>博士</div>
          <div>专科及以上</div>
        </div>
      </section>
    `;
    document.querySelector("[placeholder='请选择工作经验要求']").addEventListener("click", () => {
      events.push("open-experience");
      document.querySelector(".experience-popup").style.display = "block";
    });
    document.querySelector("[placeholder='请选择学历要求']").addEventListener("click", () => {
      events.push("open-education");
      document.querySelector(".education-popup").style.display = "block";
    });
    document.querySelector(".experience-popup div:nth-child(3)").addEventListener("click", () => events.push("select-experience"));
    document.querySelector(".education-popup div:nth-child(2)").addEventListener("click", () => events.push("select-education"));

    const result = await fillRecruitingForm(
      { experience: "3-5年", education: "本科及以上" },
      document,
      { platform: "maimai", settleMs: 0, fieldDelayMs: 0 }
    );

    expect(result.filled).toEqual(["experience", "education"]);
    expect(events).toEqual(["open-experience", "select-experience", "open-education", "select-education"]);
    expect(document.querySelector(".experience-popup div:nth-child(3)").dataset.recruitingAssistantSelected).toBe("true");
    expect(document.querySelector(".education-popup div:nth-child(2)").dataset.recruitingAssistantSelected).toBe("true");
  });

  it("reopens Maimai experience and education after they already have selected values", async () => {
    const events = [];
    document.body.innerHTML = `
      <section>
        <div><span>* 经验学历</span><input readonly value="经验不限" /><input readonly value="专科及以上" /></div>
        <div class="experience-popup" style="display: none">
          <div>1年以内</div>
          <div>1–3年</div>
          <div>3–5年</div>
          <div>5–10年</div>
          <div>10年以上</div>
          <div>经验不限</div>
        </div>
        <div class="education-popup" style="display: none">
          <div>学历不限</div>
          <div>本科及以上</div>
          <div>硕士及以上</div>
          <div>博士</div>
          <div>专科及以上</div>
        </div>
      </section>
    `;
    document.querySelectorAll("input")[0].addEventListener("click", () => {
      events.push("open-experience");
      document.querySelector(".experience-popup").style.display = "block";
    });
    document.querySelectorAll("input")[1].addEventListener("click", () => {
      events.push("open-education");
      document.querySelector(".education-popup").style.display = "block";
    });
    document.querySelector(".experience-popup div:nth-child(3)").addEventListener("click", () => events.push("select-experience"));
    document.querySelector(".education-popup div:nth-child(2)").addEventListener("click", () => events.push("select-education"));

    const result = await fillRecruitingForm(
      { experience: "3-5年", education: "本科及以上" },
      document,
      { platform: "maimai", settleMs: 0, fieldDelayMs: 0 }
    );

    expect(result.filled).toEqual(["experience", "education"]);
    expect(events).toEqual(["open-experience", "select-experience", "open-education", "select-education"]);
  });

  it("waits for Maimai experience and education options before opening industry", async () => {
    const events = [];
    document.body.innerHTML = `
      <section>
        <div><span>* 经验学历</span>
          <div class="select-control"><span>请选择工作经验要求</span></div>
          <div class="select-control"><span>请选择学历要求</span></div>
        </div>
        <div class="experience-popup" style="display: none"><div>3–5年</div></div>
        <div class="education-popup" style="display: none"><div>本科及以上</div></div>
        <div><span>* 行业要求</span><div role="button">选择对候选人的行业要求，推送更准确</div></div>
        <div class="industry-modal" style="display: none">
          <div class="left-pane"><div>不限行业</div></div>
          <div class="right-pane"><div>不限行业</div></div>
          <button>确定</button>
        </div>
      </section>
    `;
    const experiencePopup = document.querySelector(".experience-popup");
    const educationPopup = document.querySelector(".education-popup");
    document.querySelectorAll(".select-control")[0].addEventListener("click", () => {
      events.push("open-experience");
      setTimeout(() => {
        experiencePopup.style.display = "block";
      }, 180);
    });
    document.querySelectorAll(".select-control")[1].addEventListener("click", () => {
      events.push("open-education");
      setTimeout(() => {
        educationPopup.style.display = "block";
      }, 180);
    });
    document.querySelector(".experience-popup div").addEventListener("click", () => {
      events.push(`select-experience-visible-${experiencePopup.style.display === "block"}`);
      document.querySelector(".experience-popup").style.display = "none";
    });
    document.querySelector(".education-popup div").addEventListener("click", () => {
      events.push(`select-education-visible-${educationPopup.style.display === "block"}`);
      document.querySelector(".education-popup").style.display = "none";
    });
    textButton("选择对候选人的行业要求，推送更准确").addEventListener("click", () => {
      events.push(`open-industry-after-${events.at(-1)}`);
      document.querySelector(".industry-modal").style.display = "block";
    });
    document.querySelector(".right-pane div").addEventListener("click", () => events.push("select-industry"));
    textButton("确定").addEventListener("click", () => events.push("confirm-industry"));

    const result = await fillRecruitingForm(
      { experience: "3-5年", education: "本科及以上" },
      document,
      { platform: "maimai", settleMs: 20, fieldDelayMs: 0 }
    );

    expect(result.filled).toEqual(["experience", "education", "industry"]);
    expect(events).toEqual([
      "open-experience",
      "select-experience-visible-true",
      "open-education",
      "select-education-visible-true",
      "open-industry-after-select-education-visible-true",
      "select-industry",
      "confirm-industry"
    ]);
  });

  it("clicks Maimai requirement select boxes instead of their placeholder text", async () => {
    const events = [];
    document.body.innerHTML = `
      <section>
        <div class="requirement-row">
          <div><span>* 经验学历</span></div>
          <div class="select-shell"><span>请选择工作经验要求</span><i>⌄</i></div>
          <div class="select-shell"><span>请选择学历要求</span><i>⌄</i></div>
        </div>
        <div class="experience-popup" style="display: none"><div>3–5年</div></div>
        <div class="education-popup" style="display: none"><div>本科及以上</div></div>
      </section>
    `;
    document.querySelectorAll(".select-shell")[0].addEventListener("mousedown", (event) => {
      if (event.target !== event.currentTarget) return;
      events.push("open-experience-shell");
      document.querySelector(".experience-popup").style.display = "block";
    });
    document.querySelectorAll(".select-shell")[1].addEventListener("mousedown", (event) => {
      if (event.target !== event.currentTarget) return;
      events.push("open-education-shell");
      document.querySelector(".education-popup").style.display = "block";
    });
    document.querySelector(".experience-popup div").addEventListener("click", () => events.push("select-experience"));
    document.querySelector(".education-popup div").addEventListener("click", () => events.push("select-education"));

    const result = await fillRecruitingForm(
      { experience: "3-5年", education: "本科及以上" },
      document,
      { platform: "maimai", settleMs: 0, fieldDelayMs: 0 }
    );

    expect(result.filled).toEqual(["experience", "education"]);
    expect(events).toEqual(["open-experience-shell", "select-experience", "open-education-shell", "select-education"]);
  });

  it("uses the visible requirement row controls before duplicate placeholder text elsewhere", async () => {
    const events = [];
    document.body.innerHTML = `
      <section>
        <div class="template-copy"><span>请选择工作经验要求</span><span>请选择学历要求</span></div>
        <div class="requirement-row">
          <div><span>* 经验学历</span></div>
          <div class="select-shell"><span>请选择工作经验要求</span><i>⌄</i></div>
          <div class="select-shell"><span>请选择学历要求</span><i>⌄</i></div>
        </div>
        <div class="experience-popup" style="display: none"><div>3–5年</div></div>
        <div class="education-popup" style="display: none"><div>本科及以上</div></div>
      </section>
    `;
    document.querySelector(".template-copy").addEventListener("mousedown", () => events.push("wrong-template"));
    document.querySelectorAll(".select-shell")[0].addEventListener("mousedown", () => {
      events.push("open-experience-shell");
      document.querySelector(".experience-popup").style.display = "block";
    });
    document.querySelectorAll(".select-shell")[1].addEventListener("mousedown", () => {
      events.push("open-education-shell");
      document.querySelector(".education-popup").style.display = "block";
    });
    document.querySelector(".experience-popup div").addEventListener("click", () => events.push("select-experience"));
    document.querySelector(".education-popup div").addEventListener("click", () => events.push("select-education"));

    const result = await fillRecruitingForm(
      { experience: "3-5年", education: "本科及以上" },
      document,
      { platform: "maimai", settleMs: 0, fieldDelayMs: 0 }
    );

    expect(result.filled).toEqual(["experience", "education"]);
    expect(events).toEqual(["open-experience-shell", "select-experience", "open-education-shell", "select-education"]);
  });

  it("treats nested Maimai select inputs as one control per requirement box", async () => {
    const events = [];
    document.body.innerHTML = `
      <section>
        <div class="requirement-row">
          <div><span>* 经验学历</span></div>
          <div class="select-shell"><input readonly placeholder="请选择工作经验要求" /><i>⌄</i></div>
          <div class="select-shell"><input readonly placeholder="请选择学历要求" /><i>⌄</i></div>
        </div>
        <div class="experience-popup" style="display: none"><div>3–5年</div></div>
        <div class="education-popup" style="display: none"><div>本科及以上</div></div>
      </section>
    `;
    document.querySelectorAll(".select-shell")[0].addEventListener("mousedown", (event) => {
      if (event.target !== event.currentTarget) return;
      events.push("open-experience-shell");
      document.querySelector(".experience-popup").style.display = "block";
    });
    document.querySelectorAll(".select-shell")[1].addEventListener("mousedown", (event) => {
      if (event.target !== event.currentTarget) return;
      events.push("open-education-shell");
      document.querySelector(".education-popup").style.display = "block";
    });
    document.querySelector(".experience-popup div").addEventListener("click", () => events.push("select-experience"));
    document.querySelector(".education-popup div").addEventListener("click", () => events.push("select-education"));

    const result = await fillRecruitingForm(
      { experience: "3-5年", education: "本科及以上" },
      document,
      { platform: "maimai", settleMs: 0, fieldDelayMs: 0, optionTimeoutMs: 80, optionPollMs: 10 }
    );

    expect(result.filled).toEqual(["experience", "education"]);
    expect(events).toEqual(["open-experience-shell", "select-experience", "open-education-shell", "select-education"]);
  });

  it("clicks the outer select shell when Maimai requirement inputs are nested in input wrappers", async () => {
    const events = [];
    document.body.innerHTML = `
      <section>
        <div class="requirement-row">
          <div><span>* 经验学历</span></div>
          <div class="maimai-select">
            <div class="input-wrap"><input readonly placeholder="请选择工作经验要求" /></div>
            <i>⌄</i>
          </div>
          <div class="maimai-select">
            <div class="input-wrap"><input readonly placeholder="请选择学历要求" /></div>
            <i>⌄</i>
          </div>
        </div>
        <div class="experience-popup" style="display: none"><div>3–5年</div></div>
        <div class="education-popup" style="display: none"><div>本科及以上</div></div>
      </section>
    `;
    document.querySelectorAll(".maimai-select")[0].addEventListener("mousedown", (event) => {
      if (event.target !== event.currentTarget) return;
      events.push("open-experience-shell");
      document.querySelector(".experience-popup").style.display = "block";
    });
    document.querySelectorAll(".maimai-select")[1].addEventListener("mousedown", (event) => {
      if (event.target !== event.currentTarget) return;
      events.push("open-education-shell");
      document.querySelector(".education-popup").style.display = "block";
    });
    document.querySelector(".experience-popup div").addEventListener("click", () => events.push("select-experience"));
    document.querySelector(".education-popup div").addEventListener("click", () => events.push("select-education"));

    const result = await fillRecruitingForm(
      { experience: "3-5年", education: "本科及以上" },
      document,
      { platform: "maimai", settleMs: 0, fieldDelayMs: 0, optionTimeoutMs: 80, optionPollMs: 10 }
    );

    expect(result.filled).toEqual(["experience", "education"]);
    expect(events).toEqual(["open-experience-shell", "select-experience", "open-education-shell", "select-education"]);
  });

  it("clicks the inner input wrapper first for Maimai requirement boxes", async () => {
    const events = [];
    document.body.innerHTML = `
      <section>
        <div class="requirement-row">
          <div><span>* 经验学历</span></div>
          <div class="maimai-select">
            <div class="input-wrap"><input readonly placeholder="请选择工作经验要求" /></div>
            <i>⌄</i>
          </div>
          <div class="maimai-select">
            <div class="input-wrap"><input readonly placeholder="请选择学历要求" /></div>
            <i>⌄</i>
          </div>
        </div>
        <div class="experience-popup" style="display: none"><div>3–5年</div></div>
        <div class="education-popup" style="display: none"><div>本科及以上</div></div>
      </section>
    `;
    document.querySelectorAll(".input-wrap")[0].addEventListener("mousedown", (event) => {
      if (event.target !== event.currentTarget) return;
      events.push("open-experience-inner");
      document.querySelector(".experience-popup").style.display = "block";
    });
    document.querySelectorAll(".input-wrap")[1].addEventListener("mousedown", (event) => {
      if (event.target !== event.currentTarget) return;
      events.push("open-education-inner");
      document.querySelector(".education-popup").style.display = "block";
    });
    document.querySelectorAll(".maimai-select")[0].addEventListener("mousedown", (event) => {
      if (event.target !== event.currentTarget) return;
      events.push("wrong-experience-outer");
    });
    document.querySelectorAll(".maimai-select")[1].addEventListener("mousedown", (event) => {
      if (event.target !== event.currentTarget) return;
      events.push("wrong-education-outer");
    });
    document.querySelector(".experience-popup div").addEventListener("click", () => events.push("select-experience"));
    document.querySelector(".education-popup div").addEventListener("click", () => events.push("select-education"));

    const result = await fillRecruitingForm(
      { experience: "3-5年", education: "本科及以上" },
      document,
      { platform: "maimai", settleMs: 0, fieldDelayMs: 0, optionTimeoutMs: 80, optionPollMs: 10 }
    );

    expect(result.filled).toEqual(["experience", "education"]);
    expect(events).toEqual(["open-experience-inner", "select-experience", "open-education-inner", "select-education"]);
  });

  it("dispatches Maimai requirement clicks to the hit-tested child inside the visual box", async () => {
    const events = [];
    document.body.innerHTML = `
      <section>
        <div class="requirement-row">
          <div><span>* 经验学历</span></div>
          <div class="input-wrap"><input readonly placeholder="请选择工作经验要求" /></div>
          <div class="input-wrap"><input readonly placeholder="请选择学历要求" /></div>
        </div>
        <div class="experience-popup" style="display: none"><div>3–5年</div></div>
        <div class="education-popup" style="display: none"><div>本科及以上</div></div>
      </section>
    `;
    const inputs = document.querySelectorAll("input");
    const wrappers = document.querySelectorAll(".input-wrap");
    wrappers.forEach((wrapper, index) => {
      wrapper.getBoundingClientRect = () => ({
        left: index * 200,
        top: 0,
        width: 160,
        height: 40,
        right: index * 200 + 160,
        bottom: 40
      });
    });
    document.elementFromPoint = (x) => (x < 200 ? inputs[0] : inputs[1]);
    inputs[0].addEventListener("mousedown", () => {
      events.push("open-experience-input");
      document.querySelector(".experience-popup").style.display = "block";
    });
    inputs[1].addEventListener("mousedown", () => {
      events.push("open-education-input");
      document.querySelector(".education-popup").style.display = "block";
    });
    document.querySelector(".experience-popup div").addEventListener("click", () => events.push("select-experience"));
    document.querySelector(".education-popup div").addEventListener("click", () => events.push("select-education"));

    const result = await fillRecruitingForm(
      { experience: "3-5年", education: "本科及以上" },
      document,
      { platform: "maimai", settleMs: 0, fieldDelayMs: 0, optionTimeoutMs: 80, optionPollMs: 10 }
    );

    expect(result.filled).toEqual(["experience", "education"]);
    expect(events).toEqual(["open-experience-input", "select-experience", "open-education-input", "select-education"]);
  });

  it("clicks unclassed Maimai requirement boxes when placeholder text is nested", async () => {
    const events = [];
    document.body.innerHTML = `
      <section>
        <div class="requirement-row">
          <div><span>* 经验学历</span></div>
          <div>
            <div><span>请选择工作经验要求</span></div>
            <i>⌄</i>
          </div>
          <div>
            <div><span>请选择学历要求</span></div>
            <i>⌄</i>
          </div>
        </div>
        <div class="experience-popup" style="display: none"><div>3–5年</div></div>
        <div class="education-popup" style="display: none"><div>本科及以上</div></div>
      </section>
    `;
    const boxes = document.querySelectorAll(".requirement-row > div");
    boxes[1].addEventListener("mousedown", (event) => {
      if (event.target !== event.currentTarget) return;
      events.push("open-experience-box");
      document.querySelector(".experience-popup").style.display = "block";
    });
    boxes[2].addEventListener("mousedown", (event) => {
      if (event.target !== event.currentTarget) return;
      events.push("open-education-box");
      document.querySelector(".education-popup").style.display = "block";
    });
    document.querySelector(".experience-popup div").addEventListener("click", () => events.push("select-experience"));
    document.querySelector(".education-popup div").addEventListener("click", () => events.push("select-education"));

    const result = await fillRecruitingForm(
      { experience: "3-5年", education: "本科及以上" },
      document,
      { platform: "maimai", settleMs: 0, fieldDelayMs: 0, optionTimeoutMs: 80, optionPollMs: 10 }
    );

    expect(result.filled).toEqual(["experience", "education"]);
    expect(events).toEqual(["open-experience-box", "select-experience", "open-education-box", "select-education"]);
  });

  it("tries ancestor boxes when the initially matched Maimai requirement element does not open", async () => {
    const events = [];
    document.body.innerHTML = `
      <section>
        <div class="requirement-row">
          <div><span>* 经验学历</span></div>
          <div>
            <div role="button">请选择工作经验要求</div>
            <i>⌄</i>
          </div>
          <div>
            <div role="button">请选择学历要求</div>
            <i>⌄</i>
          </div>
        </div>
        <div class="experience-popup" style="display: none"><div>3–5年</div></div>
        <div class="education-popup" style="display: none"><div>本科及以上</div></div>
      </section>
    `;
    const boxes = document.querySelectorAll(".requirement-row > div");
    boxes[1].addEventListener("mousedown", (event) => {
      if (event.target !== event.currentTarget) return;
      events.push("open-experience-box");
      document.querySelector(".experience-popup").style.display = "block";
    });
    boxes[2].addEventListener("mousedown", (event) => {
      if (event.target !== event.currentTarget) return;
      events.push("open-education-box");
      document.querySelector(".education-popup").style.display = "block";
    });
    document.querySelector(".experience-popup div").addEventListener("click", () => events.push("select-experience"));
    document.querySelector(".education-popup div").addEventListener("click", () => events.push("select-education"));

    const result = await fillRecruitingForm(
      { experience: "3-5年", education: "本科及以上" },
      document,
      { platform: "maimai", settleMs: 0, fieldDelayMs: 0, optionTimeoutMs: 80, optionPollMs: 10 }
    );

    expect(result.filled).toEqual(["experience", "education"]);
    expect(events).toEqual(["open-experience-box", "select-experience", "open-education-box", "select-education"]);
  });

  it("promotes unclassed readonly requirement inputs to their visual boxes", async () => {
    const events = [];
    document.body.innerHTML = `
      <section>
        <div class="requirement-row">
          <div><span>* 经验学历</span></div>
          <div><input readonly placeholder="请选择工作经验要求" /><i>⌄</i></div>
          <div><input readonly placeholder="请选择学历要求" /><i>⌄</i></div>
        </div>
        <div class="experience-popup" style="display: none"><div>3–5年</div></div>
        <div class="education-popup" style="display: none"><div>本科及以上</div></div>
      </section>
    `;
    const boxes = document.querySelectorAll(".requirement-row > div");
    boxes[1].addEventListener("mousedown", (event) => {
      if (event.target !== event.currentTarget) return;
      events.push("open-experience-box");
      document.querySelector(".experience-popup").style.display = "block";
    });
    boxes[2].addEventListener("mousedown", (event) => {
      if (event.target !== event.currentTarget) return;
      events.push("open-education-box");
      document.querySelector(".education-popup").style.display = "block";
    });
    document.querySelector(".experience-popup div").addEventListener("click", () => events.push("select-experience"));
    document.querySelector(".education-popup div").addEventListener("click", () => events.push("select-education"));

    const result = await fillRecruitingForm(
      { experience: "3-5年", education: "本科及以上" },
      document,
      { platform: "maimai", settleMs: 0, fieldDelayMs: 0, optionTimeoutMs: 80, optionPollMs: 10 }
    );

    expect(result.filled).toEqual(["experience", "education"]);
    expect(events).toEqual(["open-experience-box", "select-experience", "open-education-box", "select-education"]);
  });

  it("clicks the exact placeholder boxes for Maimai experience and education", async () => {
    const events = [];
    document.body.innerHTML = `
      <section>
        <div class="requirement-row">
          <div><span>* 经验学历</span></div>
          <div><input placeholder="请选择工作经验要求" /><i>⌄</i></div>
          <div><input placeholder="请选择学历要求" /><i>⌄</i></div>
        </div>
        <div class="experience-popup" style="display: none"><div>3–5年</div></div>
        <div class="education-popup" style="display: none"><div>本科及以上</div></div>
      </section>
    `;
    const boxes = document.querySelectorAll(".requirement-row > div");
    boxes[1].addEventListener("mousedown", (event) => {
      if (event.target !== event.currentTarget) return;
      events.push("open-experience-box");
      document.querySelector(".experience-popup").style.display = "block";
    });
    boxes[2].addEventListener("mousedown", (event) => {
      if (event.target !== event.currentTarget) return;
      events.push("open-education-box");
      document.querySelector(".education-popup").style.display = "block";
    });
    document.querySelector(".experience-popup div").addEventListener("click", () => events.push("select-experience"));
    document.querySelector(".education-popup div").addEventListener("click", () => events.push("select-education"));

    const result = await fillRecruitingForm(
      { experience: "3-5年", education: "本科及以上" },
      document,
      { platform: "maimai", settleMs: 0, fieldDelayMs: 0, optionTimeoutMs: 80, optionPollMs: 10 }
    );

    expect(result.filled).toEqual(["experience", "education"]);
    expect(events).toEqual(["open-experience-box", "select-experience", "open-education-box", "select-education"]);
  });

  it("does not horizontally center the page while clicking Maimai requirement controls", async () => {
    const scrollCalls = [];
    document.body.innerHTML = `
      <section>
        <div class="requirement-row">
          <div><span>* 经验学历</span></div>
          <div><input readonly placeholder="请选择工作经验要求" /></div>
          <div><input readonly placeholder="请选择学历要求" /></div>
        </div>
        <div class="experience-popup" style="display: none"><div>3–5年</div></div>
        <div class="education-popup" style="display: none"><div>本科及以上</div></div>
      </section>
    `;
    document.querySelectorAll("div").forEach((element) => {
      element.scrollIntoView = (options) => scrollCalls.push(options);
    });
    const boxes = document.querySelectorAll(".requirement-row > div");
    boxes[1].addEventListener("mousedown", () => {
      document.querySelector(".experience-popup").style.display = "block";
    });
    boxes[2].addEventListener("mousedown", () => {
      document.querySelector(".education-popup").style.display = "block";
    });

    await fillRecruitingForm(
      { experience: "3-5年", education: "本科及以上" },
      document,
      { platform: "maimai", settleMs: 0, fieldDelayMs: 0, optionTimeoutMs: 80, optionPollMs: 10 }
    );

    expect(scrollCalls.every((options) => options?.inline !== "center")).toBe(true);
  });

  it("clicks right unrestricted industry, then confirms", async () => {
    const events = [];
    document.body.innerHTML = `
      <section>
        <div><span>* 行业要求</span><div role="button">选择对候选人的行业要求，推送更准确</div></div>
        <div class="modal" style="display: none">
          <div>选择行业方向</div>
          <aside><div role="option" data-column="left">不限行业</div></aside>
          <main><div role="option" data-column="right">不限行业</div></main>
          <footer><button>确定</button></footer>
        </div>
      </section>
    `;
    textButton("选择对候选人的行业要求，推送更准确").addEventListener("click", () => {
      document.querySelector(".modal").style.display = "block";
    });
    document.querySelector("[data-column='left']").addEventListener("click", () => events.push("left"));
    document.querySelector("[data-column='right']").addEventListener("click", () => events.push("right"));
    textButton("确定").addEventListener("click", () => events.push("confirm"));

    const result = await fillRecruitingForm(
      {},
      document,
      { platform: "maimai", settleMs: 0 }
    );

    expect(result.filled).toEqual(["industry"]);
    expect(events).toEqual(["right", "confirm"]);
    expect(document.querySelector("[data-column='left']").dataset.recruitingAssistantSelected).toBeUndefined();
    expect(document.querySelector("[data-column='right']").dataset.recruitingAssistantSelected).toBe("true");
    expect(textButton("确定").dataset.recruitingAssistantSelected).toBe("true");
  });

  it("clicks plain right unrestricted industry text and confirms", async () => {
    const events = [];
    document.body.innerHTML = `
      <section>
        <div><span>* 行业要求</span><div role="button">选择对候选人的行业要求，推送更准确</div></div>
        <div class="modal" style="display: none">
          <div>选择行业方向</div>
          <div class="left-pane"><div>不限行业</div></div>
          <div class="right-pane"><div>不限行业</div></div>
          <button>确定</button>
        </div>
      </section>
    `;
    textButton("选择对候选人的行业要求，推送更准确").addEventListener("click", () => {
      document.querySelector(".modal").style.display = "block";
    });
    document.querySelector(".left-pane div").addEventListener("click", () => events.push("left"));
    document.querySelector(".right-pane div").addEventListener("click", () => events.push("right"));
    textButton("确定").addEventListener("click", () => events.push("confirm"));

    const result = await fillRecruitingForm(
      {},
      document,
      { platform: "maimai", settleMs: 0 }
    );

    expect(result.filled).toEqual(["industry"]);
    expect(events).toEqual(["right", "confirm"]);
    expect(document.querySelector(".left-pane div").dataset.recruitingAssistantSelected).toBeUndefined();
    expect(document.querySelector(".right-pane div").dataset.recruitingAssistantSelected).toBe("true");
  });
});

function textButton(text) {
  return Array.from(document.querySelectorAll("[role='button'],button,div")).find(
    (element) => element.textContent.trim() === text
  );
}
