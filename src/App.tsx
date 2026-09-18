import { useEffect, useMemo, useState } from "react";
import "./styles.css";

/* ---------------- 类型 ---------------- */

type GasType = "空气" | "高氧" | "Trimix";
type CleanStatus = "氧气清洁" | "非氧气清洁" | "待清洗";
type AdapterStatus = "空闲" | "占用" | "待清洗";

interface Cylinder {
  id: string; // 气瓶编号
  volume: string; // 容积
  thread: string; // 瓶阀螺纹
  gas: GasType; // 充填气体
  cleanStatus: CleanStatus; // 清洁状态
  inspectionDue: string; // 检验有效期 YYYY-MM-DD
  residual: number; // 残压 bar
  target: number; // 目标压力 bar
  o2: number; // 氧含量 %
  he: number; // 氦含量 %
  method: string; // 充填方式
  operator: string; // 操作员
}

interface Adapter {
  id: string;
  thread: string;
  oxygenClean: boolean;
  status: AdapterStatus;
  cylinderId: string | null; // 占用时指向气瓶
}

interface FillRecord {
  id: string;
  cylinderId: string;
  adapterId: string;
  time: string;
  mix: string;
  residual: number;
  target: number;
  method: string;
  operator: string;
  note: string;
}

interface AppState {
  queue: Cylinder[];
  adapters: Adapter[];
  history: FillRecord[];
}

/* ---------------- 常量与工具 ---------------- */

const THREADS = ["G3/4", "M25×2", "5/8 BSP"];
const GASES: GasType[] = ["空气", "高氧", "Trimix"];
const CLEAN_STATUSES: CleanStatus[] = ["氧气清洁", "非氧气清洁", "待清洗"];
const METHODS = ["直充", "膜分离", "分压法", "连续流"];
const STORAGE_KEY = "hxyfront-62010-adapter-dispatch-v1";

function todayStr(): string {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mm}-${dd}`;
}

function isExpired(c: Cylinder): boolean {
  return c.inspectionDue !== "" && c.inspectionDue < todayStr();
}

function daysLeft(due: string): number {
  const a = new Date(due + "T00:00:00").getTime();
  const b = new Date(todayStr() + "T00:00:00").getTime();
  return Math.round((a - b) / 86400000);
}

function mixLabel(gas: GasType, o2: number, he: number): string {
  if (gas === "空气") return "空气 O₂ 21%";
  if (gas === "高氧") return `EAN${o2}`;
  return `Tx ${o2}/${he}`;
}

function modDepth(o2: number): number {
  if (o2 <= 0) return 0;
  return Math.max(0, Math.floor((1.4 / (o2 / 100) - 1) * 10));
}

function mixHint(gas: GasType, o2: number, he: number): string {
  if (gas === "空气") return "压缩空气 · O₂ 21% · 可使用任意同螺纹转接头";
  if (gas === "高氧")
    return `EAN${o2} · 最大操作深度约 ${modDepth(o2)}m · 必须使用氧气清洁转接头`;
  return `Trimix ${o2}/${he} · 最大操作深度约 ${modDepth(o2)}m · 必须使用氧气清洁转接头`;
}

/** 可分配给该瓶的转接头：空闲 + 螺纹匹配 + 气体清洁规则 + 检验未过期 */
function eligibleAdapters(c: Cylinder, adapters: Adapter[]): Adapter[] {
  if (isExpired(c)) return [];
  return adapters.filter(
    (a) =>
      a.status === "空闲" &&
      a.thread === c.thread &&
      (c.gas === "空气" || a.oxygenClean)
  );
}

/* ---------------- 种子数据 ---------------- */

function seedState(): AppState {
  return {
    adapters: [
      { id: "ADP-01", thread: "G3/4", oxygenClean: true, status: "空闲", cylinderId: null },
      { id: "ADP-02", thread: "G3/4", oxygenClean: true, status: "占用", cylinderId: "TANK-219" },
      { id: "ADP-03", thread: "G3/4", oxygenClean: false, status: "空闲", cylinderId: null },
      { id: "ADP-04", thread: "M25×2", oxygenClean: true, status: "空闲", cylinderId: null },
      { id: "ADP-05", thread: "M25×2", oxygenClean: false, status: "空闲", cylinderId: null },
      { id: "ADP-06", thread: "5/8 BSP", oxygenClean: true, status: "待清洗", cylinderId: null },
    ],
    queue: [
      { id: "TANK-204", volume: "12L 铝瓶", thread: "G3/4", gas: "空气", cleanStatus: "非氧气清洁", inspectionDue: "2027-03-01", residual: 55, target: 200, o2: 21, he: 0, method: "直充", operator: "阿豪" },
      { id: "TANK-219", volume: "11L 钢瓶", thread: "G3/4", gas: "高氧", cleanStatus: "氧气清洁", inspectionDue: "2026-10-20", residual: 30, target: 220, o2: 32, he: 0, method: "分压法", operator: "小林" },
      { id: "TANK-231", volume: "双瓶组 2×12L", thread: "M25×2", gas: "Trimix", cleanStatus: "氧气清洁", inspectionDue: "2026-09-10", residual: 20, target: 200, o2: 21, he: 35, method: "连续流", operator: "阿豪" },
      { id: "TANK-240", volume: "12L 钢瓶", thread: "M25×2", gas: "高氧", cleanStatus: "氧气清洁", inspectionDue: "2027-01-15", residual: 40, target: 232, o2: 36, he: 0, method: "膜分离", operator: "老周" },
      { id: "TANK-255", volume: "10L 钢瓶", thread: "5/8 BSP", gas: "空气", cleanStatus: "非氧气清洁", inspectionDue: "2026-12-01", residual: 60, target: 200, o2: 21, he: 0, method: "直充", operator: "小林" },
    ],
    history: [
      {
        id: "R-seed-1",
        cylinderId: "TANK-204",
        adapterId: "ADP-03",
        time: "2026-09-12 10:24",
        mix: "空气 O₂ 21%",
        residual: 40,
        target: 200,
        method: "直充",
        operator: "阿豪",
        note: "充填完成，转接头已释放",
      },
    ],
  };
}

function loadState(): AppState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return seedState();
    const parsed = JSON.parse(raw) as AppState;
    if (!Array.isArray(parsed.queue) || !Array.isArray(parsed.adapters) || !Array.isArray(parsed.history)) {
      return seedState();
    }
    return parsed;
  } catch {
    return seedState();
  }
}

/* ---------------- 队列行 ---------------- */

interface RowProps {
  cyl: Cylinder;
  adapters: Adapter[];
  onAssign: (cylinderId: string, adapterId: string) => void;
  onComplete: (cylinderId: string) => void;
  onRemove: (cylinderId: string) => void;
}

function QueueRow({ cyl, adapters, onAssign, onComplete, onRemove }: RowProps) {
  const [pick, setPick] = useState("");
  const occupiedBy = adapters.find((a) => a.cylinderId === cyl.id && a.status === "占用");
  const expired = isExpired(cyl);
  const eligible = eligibleAdapters(cyl, adapters);
  const left = daysLeft(cyl.inspectionDue);

  let blockedReason = "";
  if (!expired && !occupiedBy && eligible.length === 0) {
    const sameThread = adapters.filter((a) => a.thread === cyl.thread);
    if (sameThread.length === 0) blockedReason = "架上无此螺纹规格的转接头";
    else if (sameThread.every((a) => a.status === "待清洗")) blockedReason = "同螺纹转接头全部待清洗，请先完成清洗";
    else if (cyl.gas !== "空气" && !sameThread.some((a) => a.oxygenClean && a.status === "空闲"))
      blockedReason = "高氧 / Trimix 必须使用空闲的氧气清洁转接头";
    else blockedReason = "同螺纹转接头均被占用，等待释放";
  }

  const gasClass = cyl.gas === "空气" ? "gas-air" : cyl.gas === "高氧" ? "gas-nitrox" : "gas-trimix";
  const cleanClass =
    cyl.cleanStatus === "氧气清洁" ? "clean-ok" : cyl.cleanStatus === "待清洗" ? "clean-wait" : "clean-no";

  return (
    <article className={`queue-row${expired ? " expired" : ""}${occupiedBy ? " occupied" : ""}`}>
      <div className="row-top">
        <h3>{cyl.id}</h3>
        <span className="vol">{cyl.volume}</span>
        <span className="tag tag-thread">{cyl.thread}</span>
        <span className={`tag ${gasClass}`}>{mixLabel(cyl.gas, cyl.o2, cyl.he)}</span>
        <span className={`tag ${cleanClass}`}>{cyl.cleanStatus}</span>
        {expired ? (
          <span className="tag tag-expired">检验已过期 {-left} 天</span>
        ) : left <= 30 ? (
          <span className="tag tag-soon">检验剩余 {left} 天</span>
        ) : (
          <span className="tag tag-valid">检验至 {cyl.inspectionDue}</span>
        )}
      </div>

      <p className="row-meta">
        残压 {cyl.residual}bar → 目标 {cyl.target}bar · {cyl.method} · 操作员 {cyl.operator || "—"}
        <br />
        <span className="mix-hint">{mixHint(cyl.gas, cyl.o2, cyl.he)}</span>
      </p>

      {expired && (
        <p className="danger-text">检验过期瓶不得占用适配器：请先送检，检验有效期内才可分配转接头。</p>
      )}

      {occupiedBy && (
        <div className="row-actions">
          <span className="pill busy">充填中 · 占用 {occupiedBy.id}</span>
          <button className="primary" onClick={() => onComplete(cyl.id)}>
            完成充填 · 签收并释放转接头
          </button>
        </div>
      )}

      {!expired && !occupiedBy && eligible.length > 0 && (
        <div className="row-actions">
          <select value={pick} onChange={(e) => setPick(e.target.value)}>
            <option value="">选择转接头（{eligible.length} 个可用）</option>
            {eligible.map((a) => (
              <option key={a.id} value={a.id}>
                {a.id} · {a.thread} · {a.oxygenClean ? "氧气清洁" : "非氧气清洁"}
              </option>
            ))}
          </select>
          <button
            className="primary"
            disabled={!pick}
            onClick={() => {
              onAssign(cyl.id, pick);
              setPick("");
            }}
          >
            分配转接头
          </button>
          <button className="ghost" onClick={() => onRemove(cyl.id)}>
            移出队列
          </button>
        </div>
      )}

      {!expired && !occupiedBy && eligible.length === 0 && (
        <div className="row-actions">
          <span className="hint">⏳ {blockedReason}</span>
          <button className="ghost" onClick={() => onRemove(cyl.id)}>
            移出队列
          </button>
        </div>
      )}
    </article>
  );
}

/* ---------------- 主组件 ---------------- */

const emptyForm = {
  id: "",
  volume: "12L 铝瓶",
  thread: THREADS[0],
  gas: "空气" as GasType,
  cleanStatus: "非氧气清洁" as CleanStatus,
  inspectionDue: "",
  residual: 30,
  target: 200,
  o2: 21,
  he: 0,
  method: METHODS[0],
  operator: "",
};

const FILTERS = ["全部", "空气", "高氧", "Trimix", "检验过期"];

function App() {
  const [state, setState] = useState<AppState>(loadState);
  const [form, setForm] = useState(emptyForm);
  const [formError, setFormError] = useState("");
  const [filter, setFilter] = useState("全部");
  const [historyFor, setHistoryFor] = useState("");

  // 刷新后队列与占用关系仍保留
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }, [state]);

  /* ---- 调度动作 ---- */

  function assignAdapter(cylinderId: string, adapterId: string) {
    setState((prev) => {
      const cyl = prev.queue.find((c) => c.id === cylinderId);
      const adp = prev.adapters.find((a) => a.id === adapterId);
      if (!cyl || !adp) return prev;
      if (isExpired(cyl)) return prev; // 检验过期瓶不得占用适配器
      if (adp.status !== "空闲" || adp.thread !== cyl.thread) return prev; // 释放前不能分给第二瓶
      if (cyl.gas !== "空气" && !adp.oxygenClean) return prev; // 高氧/Trimix 必须氧气清洁
      return {
        ...prev,
        adapters: prev.adapters.map((a) =>
          a.id === adapterId ? { ...a, status: "占用" as AdapterStatus, cylinderId } : a
        ),
      };
    });
  }

  function completeFill(cylinderId: string) {
    setState((prev) => {
      const cyl = prev.queue.find((c) => c.id === cylinderId);
      const adp = prev.adapters.find((a) => a.cylinderId === cylinderId && a.status === "占用");
      if (!cyl || !adp) return prev;
      // 氧气清洁转接头接触空气瓶后必须转入待清洗
      const contaminated = adp.oxygenClean && cyl.gas === "空气";
      const record: FillRecord = {
        id: `R-${Date.now()}`,
        cylinderId: cyl.id,
        adapterId: adp.id,
        time: new Date().toLocaleString("zh-CN", { hour12: false }),
        mix: mixLabel(cyl.gas, cyl.o2, cyl.he),
        residual: cyl.residual,
        target: cyl.target,
        method: cyl.method,
        operator: cyl.operator || "—",
        note: contaminated
          ? "氧气清洁转接头接触空气瓶，已转入待清洗，清洗前不得用于高氧/Trimix"
          : "充填完成，转接头已释放",
      };
      return {
        queue: prev.queue.filter((c) => c.id !== cylinderId),
        adapters: prev.adapters.map((a) =>
          a.id === adp.id
            ? { ...a, status: (contaminated ? "待清洗" : "空闲") as AdapterStatus, cylinderId: null }
            : a
        ),
        history: [record, ...prev.history],
      };
    });
  }

  function markCleaned(adapterId: string) {
    setState((prev) => ({
      ...prev,
      adapters: prev.adapters.map((a) =>
        a.id === adapterId && a.status === "待清洗" ? { ...a, status: "空闲" as AdapterStatus } : a
      ),
    }));
  }

  function removeFromQueue(cylinderId: string) {
    setState((prev) => {
      if (prev.adapters.some((a) => a.cylinderId === cylinderId)) return prev; // 占用中不可移除
      return { ...prev, queue: prev.queue.filter((c) => c.id !== cylinderId) };
    });
  }

  function addCylinder(e: React.FormEvent) {
    e.preventDefault();
    const id = form.id.trim().toUpperCase();
    if (!id) return setFormError("请填写气瓶编号");
    if (state.queue.some((c) => c.id === id)) return setFormError(`编号 ${id} 已在队列中`);
    if (!form.inspectionDue) return setFormError("请选择检验有效期");
    const cyl: Cylinder = {
      ...form,
      id,
      o2: form.gas === "空气" ? 21 : form.o2,
      he: form.gas === "Trimix" ? form.he : 0,
    };
    setState((prev) => ({ ...prev, queue: [...prev.queue, cyl] }));
    setForm({ ...emptyForm, operator: form.operator });
    setFormError("");
  }

  /* ---- 派生数据 ---- */

  const gasOrder: Record<GasType, number> = { 空气: 0, 高氧: 1, Trimix: 2 };
  const cleanOrder: Record<CleanStatus, number> = { 氧气清洁: 0, 非氧气清洁: 1, 待清洗: 2 };

  // 每瓶按瓶阀螺纹 → 充填气体 → 清洁状态排队
  const sortedQueue = useMemo(
    () =>
      [...state.queue].sort(
        (a, b) =>
          a.thread.localeCompare(b.thread) ||
          gasOrder[a.gas] - gasOrder[b.gas] ||
          cleanOrder[a.cleanStatus] - cleanOrder[b.cleanStatus]
      ),
    [state.queue]
  );

  const visibleQueue = sortedQueue.filter((c) => {
    if (filter === "全部") return true;
    if (filter === "检验过期") return isExpired(c);
    return c.gas === filter;
  });

  const waitingCount = state.queue.filter(
    (c) => !state.adapters.some((a) => a.cylinderId === c.id)
  ).length;
  const busyCount = state.adapters.filter((a) => a.status === "占用").length;
  const dirtyCount = state.adapters.filter((a) => a.status === "待清洗").length;
  const expiredCount = state.queue.filter(isExpired).length;

  const historyIds = useMemo(() => {
    const ids = new Set<string>();
    state.queue.forEach((c) => ids.add(c.id));
    state.history.forEach((h) => ids.add(h.cylinderId));
    return [...ids];
  }, [state]);

  const activeHistoryId = historyFor || historyIds[0] || "";
  const shownHistory = state.history.filter((h) => h.cylinderId === activeHistoryId);

  /* ---- 渲染 ---- */

  return (
    <main className="app">
      <section className="hero">
        <p>hxyfront-62010 · 源提示词5 · Port 62010</p>
        <h1>气瓶阀门适配器调度台</h1>
        <span>
          每瓶按瓶阀螺纹、充填气体和清洁状态排队；同一转接头在释放前不能分给第二瓶；
          氧气清洁转接头接触空气瓶后必须转入待清洗，清洗前不得继续用于高氧或 Trimix；
          检验过期瓶不得占用适配器；任务完成后释放转接头并写入单瓶历史，刷新后队列与占用关系仍保留。
        </span>
        <div>
          <button className="ghost" onClick={() => setState(seedState())}>
            重置演示数据
          </button>
        </div>
      </section>

      <section className="metrics">
        <article>
          <small>待充填（未占用）</small>
          <strong>{waitingCount}</strong>
        </article>
        <article>
          <small>占用中转接头</small>
          <strong>{busyCount}</strong>
        </article>
        <article>
          <small>待清洗转接头</small>
          <strong>{dirtyCount}</strong>
        </article>
        <article>
          <small>检验过期瓶</small>
          <strong>{expiredCount}</strong>
        </article>
      </section>

      <section className="workspace">
        <aside className="panel">
          <h2>转接头架</h2>
          <div className="adapter-list">
            {state.adapters.map((a) => (
              <div className="adapter-card" key={a.id}>
                <div className="row-top">
                  <h3>{a.id}</h3>
                  <span className="tag tag-thread">{a.thread}</span>
                  <span className={`tag ${a.oxygenClean ? "clean-ok" : "clean-no"}`}>
                    {a.oxygenClean ? "氧气清洁" : "非氧气清洁"}
                  </span>
                </div>
                <div className="row-actions">
                  {a.status === "空闲" && <span className="pill idle">空闲</span>}
                  {a.status === "占用" && <span className="pill busy">占用 → {a.cylinderId}</span>}
                  {a.status === "待清洗" && (
                    <>
                      <span className="pill dirty">待清洗</span>
                      <button onClick={() => markCleaned(a.id)}>清洗完成，恢复空闲</button>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        </aside>

        <section className="panel form-panel">
          <div className="heading">
            <div>
              <p>新瓶入队</p>
              <h2>登记待充填气瓶</h2>
            </div>
            <button className="primary" form="add-cylinder-form" type="submit">
              加入队列
            </button>
          </div>
          <form id="add-cylinder-form" onSubmit={addCylinder}>
            <div className="field-grid three">
              <label>
                <span>气瓶编号</span>
                <input
                  value={form.id}
                  placeholder="如 TANK-260"
                  onChange={(e) => setForm({ ...form, id: e.target.value })}
                />
              </label>
              <label>
                <span>容积</span>
                <input
                  value={form.volume}
                  onChange={(e) => setForm({ ...form, volume: e.target.value })}
                />
              </label>
              <label>
                <span>瓶阀螺纹</span>
                <select value={form.thread} onChange={(e) => setForm({ ...form, thread: e.target.value })}>
                  {THREADS.map((t) => (
                    <option key={t}>{t}</option>
                  ))}
                </select>
              </label>
              <label>
                <span>充填气体</span>
                <select
                  value={form.gas}
                  onChange={(e) => {
                    const gas = e.target.value as GasType;
                    setForm({
                      ...form,
                      gas,
                      o2: gas === "高氧" ? 32 : 21,
                      he: gas === "Trimix" ? 35 : 0,
                      cleanStatus: gas === "空气" ? "非氧气清洁" : "氧气清洁",
                    });
                  }}
                >
                  {GASES.map((g) => (
                    <option key={g}>{g}</option>
                  ))}
                </select>
              </label>
              <label>
                <span>清洁状态</span>
                <select
                  value={form.cleanStatus}
                  onChange={(e) => setForm({ ...form, cleanStatus: e.target.value as CleanStatus })}
                >
                  {CLEAN_STATUSES.map((s) => (
                    <option key={s}>{s}</option>
                  ))}
                </select>
              </label>
              <label>
                <span>检验有效期</span>
                <input
                  type="date"
                  value={form.inspectionDue}
                  onChange={(e) => setForm({ ...form, inspectionDue: e.target.value })}
                />
              </label>
              <label>
                <span>残压 (bar)</span>
                <input
                  type="number"
                  min={0}
                  value={form.residual}
                  onChange={(e) => setForm({ ...form, residual: Number(e.target.value) || 0 })}
                />
              </label>
              <label>
                <span>目标压力 (bar)</span>
                <input
                  type="number"
                  min={0}
                  value={form.target}
                  onChange={(e) => setForm({ ...form, target: Number(e.target.value) || 0 })}
                />
              </label>
              <label>
                <span>充填方式</span>
                <select value={form.method} onChange={(e) => setForm({ ...form, method: e.target.value })}>
                  {METHODS.map((m) => (
                    <option key={m}>{m}</option>
                  ))}
                </select>
              </label>
              <label>
                <span>氧含量 O₂ %</span>
                <input
                  type="number"
                  min={21}
                  max={100}
                  disabled={form.gas === "空气"}
                  value={form.o2}
                  onChange={(e) => setForm({ ...form, o2: Number(e.target.value) || 21 })}
                />
              </label>
              <label>
                <span>氦含量 He %</span>
                <input
                  type="number"
                  min={0}
                  max={79}
                  disabled={form.gas !== "Trimix"}
                  value={form.he}
                  onChange={(e) => setForm({ ...form, he: Number(e.target.value) || 0 })}
                />
              </label>
              <label>
                <span>操作员</span>
                <input
                  value={form.operator}
                  placeholder="值班操作员"
                  onChange={(e) => setForm({ ...form, operator: e.target.value })}
                />
              </label>
            </div>
            <p className="mix-hint form-hint">{mixHint(form.gas, form.o2, form.he)}</p>
            {formError && <p className="danger-text">{formError}</p>}
          </form>
        </section>
      </section>

      <section className="panel">
        <div className="heading">
          <div>
            <p>按 螺纹 → 气体 → 清洁状态 排序</p>
            <h2>待充填队列（{visibleQueue.length}）</h2>
          </div>
          <div className="chips">
            {FILTERS.map((f) => (
              <button
                key={f}
                className={filter === f ? "chip-active" : ""}
                onClick={() => setFilter(f)}
              >
                {f}
              </button>
            ))}
          </div>
        </div>
        <div className="queue-list">
          {visibleQueue.length === 0 && <p className="hint">当前筛选下没有排队气瓶。</p>}
          {visibleQueue.map((c) => (
            <QueueRow
              key={c.id}
              cyl={c}
              adapters={state.adapters}
              onAssign={assignAdapter}
              onComplete={completeFill}
              onRemove={removeFromQueue}
            />
          ))}
        </div>
      </section>

      <section className="panel">
        <div className="heading">
          <div>
            <p>单瓶历史</p>
            <h2>充填记录</h2>
          </div>
          <select value={activeHistoryId} onChange={(e) => setHistoryFor(e.target.value)}>
            {historyIds.length === 0 && <option value="">暂无气瓶</option>}
            {historyIds.map((id) => (
              <option key={id} value={id}>
                {id}
              </option>
            ))}
          </select>
        </div>
        <div className="history-list">
          {shownHistory.length === 0 && <p className="hint">{activeHistoryId} 暂无充填记录。</p>}
          {shownHistory.map((r) => (
            <article className="history-item" key={r.id}>
              <div className="row-top">
                <h3>{r.cylinderId}</h3>
                <span className="tag tag-thread">{r.adapterId}</span>
                <span className="tag gas-nitrox">{r.mix}</span>
                <span className="time">{r.time}</span>
              </div>
              <p className="row-meta">
                残压 {r.residual}bar → 充至 {r.target}bar · {r.method} · 操作员 {r.operator}
                <br />
                {r.note}
              </p>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}

export default App;
