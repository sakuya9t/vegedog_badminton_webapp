# 🏸 菜狗羽球 (VegeDog Badminton)

<p align="center">
  <img src="docs/dog_main.png" alt="VegDog Logo" width="240" />
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Framework-Next.js%2015-black?style=flat&logo=next.js" alt="Next.js 15">
  <img src="https://img.shields.io/badge/Database-Supabase-3ECF8E?style=flat&logo=supabase" alt="Supabase">
  <img src="https://img.shields.io/badge/Language-TypeScript-3178C6?style=flat&logo=typescript" alt="TypeScript">
  <img src="https://img.shields.io/badge/Styling-Tailwind%20CSS-06B6D4?style=flat&logo=tailwindcss" alt="Tailwind CSS">
  <img src="https://img.shields.io/badge/Deployment-Vercel-000000?style=flat&logo=vercel" alt="Vercel">
  <img src="https://img.shields.io/badge/License-AGPL--3.0-blue?style=flat" alt="AGPL-3.0">
  <img src="https://img.shields.io/github/v/release/leotralino/vegedog_badminton_webapp?style=flat&color=orange" alt="Latest Release">
</p>

**菜狗（VegeDog）** 是一个基于 **Next.js + Supabase** 构建的全栈 Web 应用，旨在为菜狗羽毛球群提供简洁、高效的约球管理方案。

本项目通过自动化流程取代传统的社交软件群接龙，解决了报名统计混乱、并发冲突、晚退判定困难以及收款对账繁琐等核心痛点。

<p align="left">
  <a href="https://vegedog-badminton-webapp.vercel.app/">
    <img src="docs/open_app_btn.svg" alt="打开菜狗 App">
  </a>
</p>

## 📱 应用截图

<p align="center">
  <img src="docs/screen_1.png" width="30%" alt="接龙列表" />
  &nbsp;&nbsp;&nbsp;
  <img src="docs/screen_2.png" width="30%" alt="场次详情" />
  &nbsp;&nbsp;&nbsp;
  <img src="docs/screen_3.png" width="30%" alt="付款详情" />
</p>

---

## ✨ 核心功能

- **自动化接龙**：一键参与报名，内置自动候补（Waitlist）机制。当正选名额空缺时，候补人员将按先后顺序自动填充。
- **并发冲突保护**：数据库层面采用 PostgreSQL 咨询锁（Advisory Locks），确保在高并发点击场景下，报名顺序与剩余名额的绝对准确。
- **智能晚退判定**：支持自定义"撤回截止时间"。仅对主队列成员判定晚退，候补退出不受影响。
- **多管理员支持**：接龙发起人可添加多名共同管理员，协作管理队列、付款及加时标记。
- **接龙编辑**：管理员可在锁定前修改标题、时间、地点、人数等信息，调整人数上限时自动递补或退回候补。
- **收款流程优化**：集成 Venmo 深度链接，一键跳转付款并自动预填金额与备注。付款状态自助更新，实时同步所有参与者。
- **候补递补通知**：截止日期后有人晚退时，递补的候补用户自动收到邮件通知。
- **发给球馆**：锁定接龙后，管理员一键将正式成员名单通过邮件发送给球馆。
- **关注通知**：关注其他成员后，对方发起新接龙时自动收到邮件提醒。
- **个人统计**：设置页展示参与次数、候补次数、发起次数、加时次数等数据。
- **轻量化接入**：无需安装客户端，完美适配移动端浏览器。支持 Google OAuth 与无密码 Magic Link 登录。
- **PWA 安装**：支持添加至主屏幕，新用户引导页内置安装提示，体验媲美原生 App。

---

## 🗺️ 产品路线图

### 第一阶段：核心闭环 (MVP) — 已完成
- [x] Google / 邮件 Magic Link 登录集成
- [x] 活动创建、加入、退出及自动候补逻辑
- [x] 响应式移动端 UI 适配
- [x] 个人资料页：绑定 Venmo 账号信息
- [x] 历史记录：查看过去的活动

### 第二阶段：功能完善 (V1) — 已完成
- [x] 多管理员：发起人可添加共同管理员
- [x] 付款追踪：Venmo 深度链接 + 自助标记付款状态 + 实时同步
- [x] 发给球馆：一键邮件正式成员名单
- [x] 关注通知：关注成员，接龙开启时邮件提醒
- [x] 候补递补通知：截止后晚退触发邮件通知递补成员
- [x] 接龙编辑：管理员修改标题、时间、地点、人数，人数变动自动调整队列
- [x] 个人统计：参与次数、候补、发起、加时统计
- [x] 参与者搜索：管理员在锁定接龙中快速定位成员
- [x] Vercel Analytics 集成
- [x] k6 压测：200 VU × 10 场次验证并发安全性

### 第三阶段：增强模块
- [ ] 微信推送通知
- [ ] 后台活跃度、场地、对战历史统计
- [ ] 菜狗杯：自动配对、ELO 排名、积分追踪

---

## 🚀 开发与测试

New team member? Start with [docs/development.md](docs/development.md). It walks through running a local Supabase stack (Docker + Supabase CLI) so you can develop without any shared credentials, and covers env vars, branching, and E2E tests.
