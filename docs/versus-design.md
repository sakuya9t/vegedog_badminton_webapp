# 对战 (Versus) 功能设计文档

> 状态：**待审核**。审核通过前不实现。
> 关联：复用现有 follow/notification-subscription 的会员搜索机制（[SettingsClient.tsx](../src/app/(tabs)/settings/SettingsClient.tsx)），以及现有 email 基建（nodemailer + service-role 读 `auth.users`，`ENABLE_EMAIL` 开关）。

---

## 1. 目标与范围

让用户记录单打/双打对局，经所有参与方在 app 内确认后正式发布，发布后进入「对战历史」。Phase 2 在此基础上做积分（改良 ELO）与排行榜，并补一个全局站内信系统。

### 已确认的产品决策
| 决策点 | 结论 |
|--------|------|
| Tab 布局 | **不新增第 6 个 tab**。把底部导航的「菜狗杯」槽位替换为「对战」tab；「对战」内部用二级菜单分为 **对局** 和 **菜狗杯**（排行榜）。 |
| 站内通知 | Phase 1 **仅 email** 通知 + 对战 tab 内「待你确认」列表；完整站内信中心放 **Phase 2**。 |
| 积分算法 | **随分数递减 K 值的 ELO**（低分易涨、高分难涨）。 |

### Phase 划分
- **Phase 1（本次实现目标）**：建对局、录分、draft → 确认请求 → 全员确认 → published、对战历史、公开/不公开、email 通知。
- **Phase 2（设计在此一并给出，后续实现）**：积分（ELO）、菜狗杯排行榜与分组、全局站内信中心。

---

## 2. 核心概念与生命周期

### 一场对局 = 同一批人的多局比分
一个 `match` 是**固定参与方**之间打的若干局（games）。同一批人连打两三局只算**一场 match**，参与方只在创建时选一次，之后加局只填比分、不再重选人。胜负 = 比较两队各自赢的局数。

### 角色
- **录入者 (recorder)**：创建并录入对局的人，`auth.uid()`。
- **参与方 (participants)**：对局所有选手。优先选已注册会员（昵称搜索，机制同 follow）；也支持**访客（+1）**（见下）。
  - 单打：2 人（录入者 + 1 对手）。需 **1** 名注册对手确认。
  - 双打：4 人（录入者 + 队友 vs 2 对手）。需 **3** 名注册参与方确认（队友 + 2 对手）。
  - 录入者视为隐式已确认。「confirmed by 1/2/3」= 非录入者**注册**参与方的确认进度。
  - **访客位自动确认**，不计入需确认人数（无账号可点）。

### 访客（+1）处理
对手有时是某人的 +1（非注册会员）。允许录入者**强制输入非注册昵称**，但弹**二次确认**（提示「确认不是填错？该选手将不计积分、无法点确认」）。
- 数据上：`user_id = NULL`、`is_guest = true`、`display_name` = 自由文本。
- 确认：访客位无人可点 → 自动视为已确认，不计入确认进度。
- **关键推论**：若一场对局的非录入者参与方**全是访客**（如单打 vs 访客），则没有任何注册会员能确认 → 永远无法 `published` → 自然不计积分。这正好挡住「自己编个假对手刷分」。
- 积分：访客本身**不累积积分**；计算注册玩家 ΔR 时，访客用**固定锚定分**（默认 `R0=1000`，可配）。详见第 8 节。

### 状态机
```
draft ──(录入者发送确认请求)──► pending ──(全员确认)──► published
  │                                  │
  │                                  └──(录入者编辑)──► 重置确认（见下）
  └──(录入者取消)──► canceled
```
**pending 中编辑的重置规则**：
- 改**比分 / 加减局**（结果变了）→ 作废**所有**注册参与方的确认，全员重新确认。
- 仅**替换某个选手**（填错换人）→ 只重置**被换的那个位**，其他人已确认保持有效。
- `published` 后**完全锁定**：不可编辑；如需更正只能由录入者 `cancel` 后重建。

| 状态 | 谁可见 | 说明 |
|------|--------|------|
| `draft` | 仅录入者 | 录入者填比分、选/改参与方、设公开性。完全可编辑。 |
| `pending` | 录入者 + 参与方 | 已发确认请求，email 通知非录入者参与方。各参与方在对战 tab 内点确认。录入者仍可改（改动会重置相关确认）。 |
| `published` | 按公开性（见下） | 全员确认完成。比分锁定（仅有限编辑）。进入对战历史。Phase 2 计入积分。 |
| `canceled` | 仅录入者 | 录入者放弃。 |

### 公开性 (`is_public`)
- `published` + **public**：所有登录用户可在对战历史看到。
- `published` + **private（不公开）**：仅参与方可见。
- 默认 public，创建时可切换。

---

## 3. 数据模型

> 新增 4 张表（Phase 1）+ 2 张表（Phase 2）。追加到 [supabase/schema.sql](../supabase/schema.sql)，遵循现有 RLS + SECURITY DEFINER RPC 风格。

### `matches`（Phase 1）
| 列 | 类型 | 说明 |
|----|------|------|
| `id` | uuid pk | |
| `type` | text | `singles` / `doubles` |
| `recorder_id` | uuid → profiles | 录入者 = 创建者 |
| `status` | text | `draft` / `pending` / `published` / `canceled` |
| `is_public` | boolean default true | 不公开开关 |
| `played_at` | timestamptz | 对局时间，默认 now()，可改 |
| `note` | text null | 备注 |
| `created_at` | timestamptz | |
| `published_at` | timestamptz null | 发布时间（积分按此顺序应用） |

### `match_participants`（Phase 1）
一行一个选手位。单打 2 行，双打 4 行。
| 列 | 类型 | 说明 |
|----|------|------|
| `id` | uuid pk | |
| `match_id` | uuid → matches | on delete cascade |
| `user_id` | uuid → profiles **null** | 注册会员；访客为 NULL |
| `is_guest` | boolean default false | 访客（+1）位 |
| `team` | smallint | `1` = 录入者一方，`2` = 对手方 |
| `is_recorder` | boolean | 录入者本人的位 = true |
| `confirmed` | boolean default false | 录入者位 / 访客位创建时即 true |
| `confirmed_at` | timestamptz null | |
| `display_name` | text | 注册者 = nickname 快照；访客 = 自由文本 |
| `created_at` | timestamptz | |
|  | | `unique(match_id, user_id)` where user_id not null（防同一注册人重复；访客不受限） |

> 「改名以应付填错」= 录入者在 draft/pending 时把某个位的 `user_id` 替换为另一已注册会员（并刷新 `display_name`），该位的 `confirmed` 重置为 false。

### `match_games`（Phase 1）
一行一局比分。
| 列 | 类型 | 说明 |
|----|------|------|
| `id` | uuid pk | |
| `match_id` | uuid → matches | on delete cascade |
| `game_no` | int | 1, 2, 3… |
| `team1_score` | int | team=1 一方得分 |
| `team2_score` | int | team=2 一方得分 |
| `created_at` | timestamptz | |
|  | | `unique(match_id, game_no)` |

> 胜负：比较两队各自赢的局数（games won）。支持任意局数（一局制 / 三局两胜 / 五局三胜，只看赢局多者）。

### `player_ratings`（Phase 2）
| 列 | 类型 | 说明 |
|----|------|------|
| `user_id` | uuid pk → profiles | |
| `rating` | numeric default 1000 | 当前分 |
| `games_played` | int default 0 | 已计分对局数（provisional 判定） |
| `peak_rating` | numeric | 历史最高（可选） |
| `updated_at` | timestamptz | |

### `rating_history`（Phase 2）
| 列 | 类型 | 说明 |
|----|------|------|
| `id` | uuid pk | |
| `match_id` | uuid → matches | |
| `user_id` | uuid → profiles | |
| `rating_before` | numeric | |
| `rating_after` | numeric | |
| `delta` | numeric | |
| `created_at` | timestamptz | |

---

## 4. RLS 策略

| 表 | SELECT | INSERT / UPDATE |
|----|--------|-----------------|
| `matches` | 录入者；或参与方（任意状态）；或 `published` 且 `is_public`（所有登录用户）。用 EXISTS 子查询 join `match_participants`。 | 写操作一律走 RPC（SECURITY DEFINER），表上不开放直接 insert/update（或仅录入者 update 受限列）。 |
| `match_participants` | 跟随 `matches` 可见性（同一 match 可见则其参与方可见）。 | 仅经 RPC。 |
| `match_games` | 跟随 `matches` 可见性。 | 仅经 RPC。 |
| `player_ratings` | 所有登录用户（排行榜公开）。 | 仅经 RPC / DB 函数。 |
| `rating_history` | 本人，或对应 match 可见者。 | 仅经 RPC。 |

> draft 的隔离（只有录入者能看）靠 SELECT policy：`status='draft'` 时仅 `recorder_id = auth.uid()`。

> **避免 RLS 互相递归**：`matches` 的可见性要查 `match_participants`，而 `match_participants`/`match_games` 又要回查 `matches`——若三个 policy 直接互相 join 会触发 Postgres `infinite recursion detected in policy` 错误（SELECT 直接失败 → 详情页 404）。因此可见性判断收敛到一个 **SECURITY DEFINER** 函数 `can_view_match(match_id)`（内部读绕过 RLS，打断递归环），三个表的 SELECT policy 都调用它。

---

## 5. RPC 函数（SECURITY DEFINER + 内部鉴权）

沿用现有 `join_session` / `rename_participant` 风格：函数内部做 auth 检查，必要处用 advisory lock。

| 函数 | 鉴权 / 行为 |
|------|------------|
| `create_match(p_type, p_is_public, p_played_at, p_participants jsonb)` | 录入者 = `auth.uid()`。校验人数（singles=2/doubles=4）、注册位 user_id 是真实 profile 且无重复、录入者本人在列。访客位（`is_guest=true, user_id=null`）允许，创建即 `confirmed=true`。原子插入 match + participants（录入者位 `confirmed=true`）。返回 match。 |
| `set_match_games(p_match_id, p_games jsonb)` | 仅录入者，状态 ∈ {draft, pending}。整体替换 games。**pending 下改比分 → 重置所有注册参与方 `confirmed=false`。** |
| `replace_match_participant(p_participant_id, p_new_user_id, p_guest_name)` | 仅录入者，draft/pending。换注册会员（校验 profile + 不重复）或换为访客。pending 下**仅重置被换位** `confirmed=false`。published 拒绝。 |
| `set_match_privacy(p_match_id, p_is_public)` | 仅录入者。 |
| `request_match_confirmation(p_match_id)` | 仅录入者，draft → pending。非录入者**注册**位 `confirmed=false`（访客位保持 true）。校验至少 1 局比分已录、且至少存在 1 个非录入者注册位（否则永远无法发布，拒绝或提示）。返回需通知的注册参与方列表（供 email API）。 |
| `confirm_match(p_match_id)` | 调用者须为该 match 的**非录入者注册参与方**。置其 `confirmed=true`。advisory lock(match_id) 下检查：若所有非录入者注册位 `confirmed`（访客位不计） → `status=published, published_at=now()`，（Phase 2）调用 `apply_match_rating`。 |
| `cancel_match(p_match_id)` | 仅录入者，非 published。→ canceled。 |
| `apply_match_rating(p_match_id)`（Phase 2） | 在 publish 时调用，按 ELO 增量更新 `player_ratings` 并写 `rating_history`。幂等（已写过则跳过）。 |

### Realtime
`matches` / `match_participants` / `match_games` 加入 `supabase_realtime` publication，对局详情页订阅以实时显示确认进度。

---

## 6. 通知（Phase 1 = email only）

| 触发 | API 路由 | 收件人 | 内容 |
|------|----------|--------|------|
| `request_match_confirmation` 成功后（客户端 POST） | `/api/notify-match-confirmation` | 所有**非录入者**参与方 | 比分结果 + 「请在 app 内确认」+ 对战 tab 链接 |
| publish（全员确认后，可选） | `/api/notify-match-published` | 所有参与方 | 「对局已发布」+ 结果 |

- 复用 [notify-followers/route.ts](../src/app/api/notify-followers/route.ts) 模式：`runtime='nodejs'`，`ENABLE_EMAIL` 开关，admin client 从 `auth.users` 取 email，nodemailer Gmail SMTP。
- **in-app（Phase 1）**：对战 tab「对局」子页顶部展示「待你确认」列表（你是参与方、`status='pending'`、你 `confirmed=false` 的对局）。这是 Phase 1 的站内露出；全局站内信中心见 Phase 2。

---

## 7. 前端结构（Phase 1）

底部导航：把 `BottomNav` 的「菜狗杯」项替换为「对战」（`/versus`）。原 `cup` 占位内容并入 `/versus` 的二级菜单。

```
src/app/(tabs)/versus/
  page.tsx                 # Server: 取我相关对局；二级菜单 [对局 | 对战历史 | 菜狗杯]
  VersusClient.tsx         # Client: 子页切换、待确认列表、历史列表
src/app/versus/
  new/page.tsx             # Client: 创建对局（单/双打 + 会员搜索选人 + 公开开关）
  [id]/
    page.tsx               # Server: 取 match + participants + games（按 RLS）
    MatchDetailClient.tsx  # Client: 录分、改/替换参与方、发确认请求、确认按钮、进度、realtime
src/app/api/
  notify-match-confirmation/route.ts
  notify-match-published/route.ts        # 可选
src/components/MemberPicker.tsx          # 抽取自 SettingsClient 的昵称搜索下拉，支持「强制输入访客」
```

「对战」tab 二级菜单（三个）：
- **对局**：只放「需要我处理 / 仍归我管」的：待你确认（pending 且我未确认）+ 我发起的（我的 draft/pending）。顶部「待你确认」露出；入口「+ 新对局」。
- **对战历史**：① 我可见的 published（public 全可见、private 仅参与方，RLS 已过滤）；**②** 我**已亲自确认**的 pending 对局。即「我一旦确认/录入，这场就进我的历史，不用等其他人确认」。全员确认只影响 Phase-2 积分，不影响可见性。
- **菜狗杯**：Phase 1 先保留现占位（ELO/排行榜 TODO）；Phase 2 填充排行榜 + 分组助手。

> 这样确认者 B 点确认后，对局会立刻从「待你确认」移到「对战历史」，不会因为 C/D 还没确认而消失；录入者 A 在「我发起的」里跟踪 pending 进度。

### 创建对局 UI
- 类型切换：单打 / 双打。
- 选人：复用 `MemberPicker`（昵称 `ilike` 搜索 → 下拉 → 选已注册会员）。
  - 单打：对手 ×1；双打：队友 ×1、对手 ×2。
  - **访客（+1）**：搜索无果时可「强制使用此昵称为访客」，弹二次确认（提示不计积分、无法确认）。
- 对局时间（默认现在，可改）、公开/不公开开关。
- 提交 → `create_match` → 跳详情页录分。

### 录分 UI（详情页，重点：简化录入者操作）
- 选人**只在创建时一次**。详情页就是一张「比分表」：每行一局 `[队1分] : [队2分]`，「+ 加一局」按钮即可加第 2、3 局，**无需重选人**。
- 录入者操作：填若干局 → （可选改/换人）→「发送确认请求」。
- 参与方：在「待你确认」看到结果 → 一键「确认」。进度显示 `已确认 1/3`。

---

## 8. 积分算法（Phase 2）：随分数递减 K 的 ELO

满足「低分易涨、高分难涨」，且赢强者得分多、赢弱者得分少。

### 参数（初版，审核时可调）
- 初始分 `R0 = 1000`。
- 递减 K：
  ```
  K(R) = clamp(K_max - (K_max - K_min) * (R - R_floor) / (R_ceil - R_floor), K_min, K_max)
  ```
  初值：`K_max = 64`、`K_min = 16`、`R_floor = 1000`、`R_ceil = 1800`。
  - R ≤ 1000 → K=64（低分变动大，易涨）；R ≥ 1800 → K=16（高分变动小，难涨）。
- Provisional：`games_played < 5` 时强制 `K = K_max`，让新人/低分快速收敛。

### 按局结算（per-game）
一场 match 含多局。**每一局都是一次独立的 ELO 更新**，在 publish 时按 `game_no` 顺序依次结算（玩家分随局推进）。这样「同一批人连打三局」= 三次小更新，自然反映状态，UI 仍只需录入者填三行比分、选一次人。

### 计算（每局）
- 期望分：`E = 1 / (1 + 10^((R_opp - R_self) / 400))`。
- 实际分：本局赢家 `S = 1`，输家 `S = 0`（单局无平局）。
- **比分差乘子（计入）**：`m = 1 + g(|s1 - s2|)`，例如 `g = ln(1 + |Δ|) / ln(1 + 21)`，使 21:0 比 21:19 权重更高；大分差放大变动。
- **防「打新手风险过大」的差距阻尼**：当双方分差很大时，对**热门胜方**整体缩放更新，避免高分偶尔输给低分被重罚（否则没人愿意陪新手打）。
  `damp = clamp(1 - max(0, |R_self - R_opp| - GAP0) / GAP_SCALE, DAMP_MIN, 1)`，初值 `GAP0=200, GAP_SCALE=600, DAMP_MIN=0.25`。
  效果：分差≤200 不阻尼；分差越大，高分方赢/输的变动都被压小 → 陪新手「赢得少、万一输也亏得少」，风险低。
- 双打：队伍分 = 两人平均；每人对「对方队伍平均分」算 E，各自用自己的 `K(R_self)` 更新。
- 合成：
  ```
  ΔR_self = K(R_self) * m * damp * (S - E_self)
  ```

> 访客位：用固定锚定分 `R_guest = 1000`（不更新、不写 history），只作为对手/队友参与上式。

### 入账规则
- 只有 **全员（注册参与方）确认（published）** 的对局计分；draft/pending 不计分。
- 一场对局 publish 时，其全部局**一次性按顺序入账**（`apply_match_rating` 幂等，已入账则跳过）。
- 跨对局按 `published_at` 顺序（发布即结算，不按 `played_at` 重排）。

### 排行榜 / 分组（菜狗杯子页）
- 按 `rating` 降序列出成员 + 分数 + 最近变动。
- 分组助手：按 rating 蛇形/分段切分，便于 tournament 分组。

---

## 9. 实现步骤

### Phase 1
1. **Schema 迁移**：`matches` / `match_participants` / `match_games` 表 + RLS + RPC（create/set_games/replace_participant/request_confirmation/confirm/cancel/set_privacy）+ realtime + 索引。追加进 schema.sql。
2. **类型**：`src/lib/types.ts` 增加 Match / MatchParticipant / MatchGame 及 Insert/视图类型。
3. **抽取 `MemberPicker`** 组件（自 SettingsClient 搜索逻辑）。
4. **导航改造**：`BottomNav` 菜狗杯 → 对战；建 `/versus` 二级菜单页（对局 / 对战历史 / 菜狗杯）。
5. **创建对局**：`/versus/new`（单双打、选人、时间、公开开关）。
6. **对局详情/录分**：`/versus/[id]`（录分、改/替换参与方、发确认请求、确认进度 1/2/3、确认按钮、realtime）。
7. **对局列表 + 对战历史**：我的对局分组 + 待你确认列表 + 已发布历史（公开性过滤）。
8. **Email API**：`/api/notify-match-confirmation`（+ 可选 published）。
9. **收尾**：e2e 测试、CHANGELOG、更新 architecture.md。

### Phase 2
10. `player_ratings` / `rating_history` 表 + `apply_match_rating` DB 函数（递减 K ELO），接入 `confirm_match` 的 publish 分支。
11. 菜狗杯子页：排行榜 + 成员积分/曲线 + 分组助手。
12. 全局站内信中心：`notifications` 表 + Navbar 铃铛 + 未读红点 + 列表页 + realtime；把确认请求/发布也写入站内信。

---

## 10. 已确认的决策（审核回执）
1. **双打确认人数**：4 人，需 3 名注册参与方确认（队友 + 2 对手）。录入者隐式确认。✅
2. **pending 中编辑**：改比分 → 全员重置；仅换人 → 只重置被换位。✅
3. **published 后**：完全锁定；更正需 cancel 后重建。✅
4. **积分结算**：publish 时按局顺序一次性结算；跨对局按 `published_at`。✅
5. **比分差**：计入 ELO（margin 乘子），并加差距阻尼避免高分陪打新手风险过大。✅
6. **对战历史**：独立为「对战」tab 的第三个二级菜单。✅
7. **访客（+1）**：允许强制输入非注册昵称（二次确认）；访客自动确认、不累积积分、以锚定分 1000 参与对手计算；全访客对手的对局无法发布、自然不计分。✅

## 11. 仍可微调（不阻塞实现）
- ELO 各参数（`K_max/K_min/R_floor/R_ceil`、margin 函数、阻尼 `GAP0/GAP_SCALE/DAMP_MIN`、provisional 局数）为初版数值，Phase 2 实现时可据实际数据调参。
- publish 后是否给全员发「已发布」邮件（`notify-match-published`）为可选。

---

## 12. 数据库迁移（local / dev / prod）

对战的新表/函数/RLS **不会**随代码部署自动同步——托管 Supabase 要手动把迁移 SQL 跑一次。

- **单一来源**：`supabase/schema.sql` 的「8. 对战」整块是权威定义（给全新项目）。
- **托管增量**：`supabase/migrations_versus.sql` 是从该块抽出的独立迁移文件（仅新增对战相关对象），用于已有数据的 dev/prod 库。改 schema.sql 后需同步重新生成此文件。

### 本地（local）
schema.sql 是 seed，两种方式：
- 全量重置（会清空本地数据）：`supabase db reset`
- 不动数据、只加对战对象（推荐在已有本地数据时用）：
  ```bash
  docker cp supabase/migrations_versus.sql supabase_db_<project>:/tmp/v.sql
  docker exec supabase_db_<project> psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f /tmp/v.sql
  docker exec supabase_db_<project> psql -U postgres -d postgres -c "notify pgrst, 'reload schema';"
  ```
  （`<project>` = `vegedog-badminton`。最后一步让本地 PostgREST 立即识别新 RPC。）

### dev / prod（托管 Supabase）
按分支策略 `develop → dev 库`、`main → prod 库`，**先 dev、后 prod**：
1. Supabase Dashboard → **SQL Editor** → New query
2. 粘贴 `supabase/migrations_versus.sql` **全文** → **Run**
3. dev 上合并 `feature/versus → develop`，在 Vercel preview 端到端验证（建对局/录分/确认/发布）
4. 验证 OK 后对 **prod** 库重复 1–2，再合并 `develop → main`

> 托管库执行 DDL 后会自动 reload PostgREST schema cache，无需手动 `notify pgrst`。

### 注意
- **只跑 `migrations_versus.sql`，不要对有数据的库跑整个 `schema.sql`**（里面是裸 `CREATE TABLE`，会因已存在报错）。
- 该迁移**只能跑一次**：表 / policy / `alter publication add table` 是裸 `CREATE/ADD`，重复执行会中途 `already exists`；函数是 `CREATE OR REPLACE`（可重复）。如需「能安全重跑」的幂等版（`create table if not exists`、policy 先 `drop ... if exists`、realtime 用 `do $$ ... $$` 守卫），按需另出一份。
- 新表为空，**无需数据回填**。
- 邮件依赖现有 `ENABLE_EMAIL=true` + Gmail 环境变量，无需新增。
