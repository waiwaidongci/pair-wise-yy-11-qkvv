import { useEffect, useMemo, useState } from "react";
import "./styles.css";

/* ================= 领域类型 ================= */

type Thread = "DIN" | "DIN300" | "M25" | "YOKE";
type Gas = "AIR" | "NITROX" | "TRIMIX";
type CleanLevel = "O2CLEAN" | "GENERAL" | "INDUSTRIAL";
type AdapterStatus = "FREE" | "BUSY" | "DIRTY";
type CylStatus = "WAITING" | "FILLING" | "DONE";

interface Adapter {
  id: string;
  thread: Thread;
  clean: CleanLevel;
  status: AdapterStatus;
  heldBy: string | null;
}

interface Cylinder {
  id: string;
  volume: string;
  inspection: string; // YYYY-MM-DD
  residual: number;
  target: number;
  thread: Thread;
  gas: Gas;
  clean: CleanLevel;
  o2: number; // %
  he: number; // %
  status: CylStatus;
  adapterId: string | null;
  assignedAt: string | null;
}

interface HistoryRecord {
  id: string;
  cylinderId: string;
  adapterId: string;
  gas: Gas;
  thread: Thread;
  operator: string;
  kind: "complete" | "release";
  startedAt: string | null;
  completedAt: string;
  note?: string;
}

interface PersistState {
  cylinders: Cylinder[];
  adapters: Adapter[];
  history: HistoryRecord[];
}

/* ================= 常量与展示 ================= */

const THREAD_ORDER: Thread[] = ["DIN", "DIN300", "M25", "YOKE"];
const GAS_ORDER: Gas[] = ["AIR", "NITROX", "TRIMIX"];
const CLEAN_ORDER: CleanLevel[] = ["O2CLEAN", "GENERAL", "INDUSTRIAL"];

const THREAD_LABEL: Record<Thread, string> = {
  DIN: "DIN 230bar 五爪",
  DIN300: "DIN 300bar",
  M25: "M25 欧式",
  YOKE: "Yoke 轭式",
};

const GAS_LABEL: Record<Gas, string> = {
  AIR: "空气",
  NITROX: "高氧",
  TRIMIX: "Trimix",
};

const CLEAN_LABEL: Record<CleanLevel, string> = {
  O2CLEAN: "氧气清洁",
  GENERAL: "普通",
  INDUSTRIAL: "工业级",
};

const STORE_KEY = "adapter-dispatch-console-v1";

/* ================= 工具函数 ================= */

function todayStr(): string {
  const now = new Date();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${m}-${d}`;
}

function daysUntil(dateStr: string): number {
  const target = new Date(`${dateStr}T00:00:00`).getTime();
  const today = new Date(`${todayStr()}T00:00:00`).getTime();
  return Math.round((target - today) / 86_400_000);
}

function isExpired(c: Cylinder): boolean {
  return daysUntil(c.inspection) < 0;
}

function gasBadge(c: Pick<Cylinder, "gas" | "o2" | "he">): string {
  if (c.gas === "AIR") return "AIR 21";
  if (c.gas === "NITROX") return `EAN${Math.round(c.o2)}`;
  return `Tx ${Math.round(c.o2)}/${Math.round(c.he)}`;
}

/** 最大作业深度（氧分压上限 1.4 bar），单位 m */
function modMeter(o2Percent: number): number {
  const fO2 = o2Percent / 100;
  if (fO2 <= 0) return 0;
  return Math.round(((1.4 / fO2 - 1) * 100) / 10) * 10;
}

/** 等效空气深度（ narcotic depth，按 3.16 呼吸气密度），单位 m */
function endMeter(o2Percent: number, hePercent: number): number {
  const fN2 = (100 - o2Percent - hePercent) / 100;
  if (fN2 <= 0) return 0;
  return Math.round(((3.16 / fN2 - 1) * 100) / 10) * 10;
}

function formatTime(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("zh-CN", { hour12: false });
}

/**
 * 转接头能否分给该瓶：
 * 1. 必须 FREE（占用互锁：BUSY / DIRTY 一律不可分配）
 * 2. 螺纹必须一致
 * 3. 高氧 / Trimix 只能用氧气清洁转接头
 * 4. 氧气清洁瓶只能用氧气清洁转接头（空气也不例外）
 */
function adapterMatches(a: Adapter, c: Cylinder): boolean {
  if (a.status !== "FREE") return false;
  if (a.thread !== c.thread) return false;
  if (c.gas !== "AIR") return a.clean === "O2CLEAN";
  if (c.clean === "O2CLEAN") return a.clean === "O2CLEAN";
  return true;
}

/* ================= 演示数据 ================= */

function seedState(): PersistState {
  const now = new Date();
  const yesterday = new Date(now.getTime() - 86_400_000).toISOString();
  return {
    adapters: [
      { id: "ADP-01", thread: "DIN", clean: "O2CLEAN", status: "FREE", heldBy: null },
      { id: "ADP-02", thread: "DIN", clean: "GENERAL", status: "FREE", heldBy: null },
      { id: "ADP-03", thread: "DIN300", clean: "O2CLEAN", status: "FREE", heldBy: null },
      { id: "ADP-04", thread: "YOKE", clean: "GENERAL", status: "BUSY", heldBy: "TANK-219" },
      { id: "ADP-05", thread: "M25", clean: "INDUSTRIAL", status: "FREE", heldBy: null },
      // 氧气清洁头接触过空气瓶，等待清洗复位
      { id: "ADP-06", thread: "DIN", clean: "O2CLEAN", status: "DIRTY", heldBy: null },
    ],
    cylinders: [
      {
        id: "TANK-204", volume: "12L 铝瓶", inspection: "2027-03-10",
        residual: 55, target: 200, thread: "DIN", gas: "AIR", clean: "GENERAL",
        o2: 21, he: 0, status: "WAITING", adapterId: null, assignedAt: null,
      },
      {
        id: "TANK-219", volume: "11L 钢瓶", inspection: "2027-01-22",
        residual: 40, target: 210, thread: "YOKE", gas: "AIR", clean: "GENERAL",
        o2: 21, he: 0, status: "FILLING", adapterId: "ADP-04", assignedAt: yesterday,
      },
      {
        id: "TANK-222", volume: "双瓶组 2×12L", inspection: "2027-06-01",
        residual: 30, target: 220, thread: "DIN300", gas: "TRIMIX", clean: "O2CLEAN",
        o2: 18, he: 45, status: "WAITING", adapterId: null, assignedAt: null,
      },
      {
        id: "TANK-231", volume: "15L 钢瓶", inspection: "2026-10-01",
        residual: 80, target: 230, thread: "M25", gas: "AIR", clean: "GENERAL",
        o2: 21, he: 0, status: "WAITING", adapterId: null, assignedAt: null,
      },
      {
        id: "TANK-240", volume: "12L 钢瓶", inspection: "2027-04-12",
        residual: 20, target: 200, thread: "DIN", gas: "NITROX", clean: "O2CLEAN",
        o2: 32, he: 0, status: "WAITING", adapterId: null, assignedAt: null,
      },
      {
        id: "TANK-251", volume: "S80 铝瓶", inspection: "2027-02-18",
        residual: 60, target: 207, thread: "DIN", gas: "AIR", clean: "O2CLEAN",
        o2: 21, he: 0, status: "WAITING", adapterId: null, assignedAt: null,
      },
      {
        id: "TANK-266", volume: "11.1L 铝瓶", inspection: "2027-08-08",
        residual: 0, target: 200, thread: "YOKE", gas: "NITROX", clean: "GENERAL",
        o2: 36, he: 0, status: "WAITING", adapterId: null, assignedAt: null,
      },
      {
        id: "TANK-290", volume: "12L 钢瓶", inspection: "2026-08-30",
        residual: 10, target: 200, thread: "DIN", gas: "AIR", clean: "GENERAL",
        o2: 21, he: 0, status: "WAITING", adapterId: null, assignedAt: null,
      },
      {
        id: "TANK-188", volume: "12L 钢瓶", inspection: "2027-05-05",
        residual: 45, target: 200, thread: "DIN300", gas: "AIR", clean: "INDUSTRIAL",
        o2: 21, he: 0, status: "DONE", adapterId: null, assignedAt: null,
      },
    ],
    history: [
      {
        id: "H-SEED-1",
        cylinderId: "TANK-188",
        adapterId: "ADP-03",
        gas: "AIR",
        thread: "DIN300",
        operator: "陈工",
        kind: "complete",
        startedAt: "2026-09-17T09:12:00.000Z",
        completedAt: "2026-09-17T09:46:00.000Z",
        note: "氧气清洁转接头接触空气瓶，充填后已转待清洗并完成清洗复位",
      },
    ],
  };
}

function loadState(): PersistState {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return seedState();
    const parsed = JSON.parse(raw) as PersistState;
    if (!Array.isArray(parsed.cylinders) || !Array.isArray(parsed.adapters) || !Array.isArray(parsed.history)) {
      return seedState();
    }
    return parsed;
  } catch {
    return seedState();
  }
}

/* ================= 主组件 ================= */

type GasFilter = "ALL" | Gas | "EXPIRED";

function App() {
  const initial = useMemo(loadState, []);
  const [cylinders, setCylinders] = useState<Cylinder[]>(initial.cylinders);
  const [adapters, setAdapters] = useState<Adapter[]>(initial.adapters);
  const [history, setHistory] = useState<HistoryRecord[]>(initial.history);
  const [gasFilter, setGasFilter] = useState<GasFilter>("ALL");
  const [historyCylId, setHistoryCylId] = useState<string>("TANK-188");

  // 刷新后队列与占用关系仍保留
  useEffect(() => {
    localStorage.setItem(STORE_KEY, JSON.stringify({ cylinders, adapters, history }));
  }, [cylinders, adapters, history]);

  const waiting = cylinders.filter((c) => c.status === "WAITING");
  const filling = cylinders.filter((c) => c.status === "FILLING");
  const done = cylinders.filter((c) => c.status === "DONE");

  const expiredCount = cylinders.filter((c) => c.status !== "DONE" && isExpired(c)).length;
  const dirtyCount = adapters.filter((a) => a.status === "DIRTY").length;
  const busyCount = adapters.filter((a) => a.status === "BUSY").length;

  const queue = useMemo(() => {
    const filtered = waiting.filter((c) => {
      if (gasFilter === "ALL") return true;
      if (gasFilter === "EXPIRED") return isExpired(c);
      return c.gas === gasFilter;
    });
    return [...filtered].sort((a, b) => {
      const ea = isExpired(a) ? 1 : 0;
      const eb = isExpired(b) ? 1 : 0;
      if (ea !== eb) return ea - eb; // 过期瓶沉底锁定
      return (
        THREAD_ORDER.indexOf(a.thread) - THREAD_ORDER.indexOf(b.thread) ||
        GAS_ORDER.indexOf(a.gas) - GAS_ORDER.indexOf(b.gas) ||
        CLEAN_ORDER.indexOf(a.clean) - CLEAN_ORDER.indexOf(b.clean) ||
        a.inspection.localeCompare(b.inspection) ||
        a.id.localeCompare(b.id)
      );
    });
  }, [waiting, gasFilter]);

  const historyOf = history.filter((h) => h.cylinderId === historyCylId);

  /* ---------- 调度动作 ---------- */

  function assignAdapter(cylId: string, adapterId: string) {
    const c = cylinders.find((x) => x.id === cylId);
    const a = adapters.find((x) => x.id === adapterId);
    if (!c || !a || !adapterMatches(a, c) || isExpired(c)) return;

    // 氧气清洁头接触空气瓶 → 强制提醒：完成后必须转待清洗
    if (a.clean === "O2CLEAN" && c.gas === "AIR") {
      const ok = window.confirm(
        `转接头 ${a.id} 为【氧气清洁】等级，分给空气瓶 ${c.id} 后，充填完成将强制转入待清洗，且在清洗复位前不能再用于高氧 / Trimix。\n\n确认分配？`
      );
      if (!ok) return;
    }

    const ts = new Date().toISOString();
    setAdapters((prev) =>
      prev.map((x) => (x.id === a.id ? { ...x, status: "BUSY", heldBy: c.id } : x))
    );
    setCylinders((prev) =>
      prev.map((x) =>
        x.id === c.id ? { ...x, status: "FILLING", adapterId: a.id, assignedAt: ts } : x
      )
    );
  }

  function completeFill(cylId: string, operator: string) {
    const op = operator.trim();
    if (!op) return;
    const c = cylinders.find((x) => x.id === cylId);
    if (!c || c.status !== "FILLING" || !c.adapterId) return;
    const a = adapters.find((x) => x.id === c.adapterId);
    if (!a) return;

    const now = new Date().toISOString();
    // 唯一的"污染"路径：氧气清洁转接头接触空气瓶
    const becomesDirty = a.clean === "O2CLEAN" && c.gas === "AIR";

    setAdapters((prev) =>
      prev.map((x) =>
        x.id === a.id
          ? { ...x, status: becomesDirty ? "DIRTY" : "FREE", heldBy: null }
          : x
      )
    );
    setCylinders((prev) =>
      prev.map((x) =>
        x.id === c.id ? { ...x, status: "DONE", adapterId: null } : x
      )
    );
    setHistory((prev) => [
      {
        id: `H-${Date.now()}`,
        cylinderId: c.id,
        adapterId: a.id,
        gas: c.gas,
        thread: c.thread,
        operator: op,
        kind: "complete",
        startedAt: c.assignedAt,
        completedAt: now,
        note: becomesDirty
          ? "氧气清洁转接头接触空气瓶，已强制转入待清洗，清洗复位前不得用于高氧 / Trimix"
          : undefined,
      },
      ...prev,
    ]);
  }

  function releaseBack(cylId: string) {
    const c = cylinders.find((x) => x.id === cylId);
    if (!c || c.status !== "FILLING" || !c.adapterId) return;
    const a = adapters.find((x) => x.id === c.adapterId);
    if (!a) return;
    // 氧气清洁头只要接触过空气瓶，无论是否完成充填都必须转待清洗
    const becomesDirty = a.clean === "O2CLEAN" && c.gas === "AIR";
    if (!window.confirm(
      becomesDirty
        ? `转接头 ${a.id} 为氧气清洁等级且已接触空气瓶 ${c.id}，拆回后将强制转入待清洗。确认拆回？`
        : `将转接头 ${a.id} 从 ${c.id} 拆回并释放？瓶会回到排队末尾。`
    )) return;

    setAdapters((prev) =>
      prev.map((x) =>
        x.id === a.id
          ? { ...x, status: becomesDirty ? "DIRTY" : "FREE", heldBy: null }
          : x
      )
    );
    setCylinders((prev) =>
      prev.map((x) =>
        x.id === c.id ? { ...x, status: "WAITING", adapterId: null, assignedAt: null } : x
      )
    );
    setHistory((prev) => [
      {
        id: `H-${Date.now()}`,
        cylinderId: c.id,
        adapterId: a.id,
        gas: c.gas,
        thread: c.thread,
        operator: "调度台（拆回）",
        kind: "release",
        startedAt: c.assignedAt,
        completedAt: new Date().toISOString(),
        note: becomesDirty
          ? "未签收即拆回：氧气清洁转接头已接触空气瓶，强制转入待清洗"
          : "未签收，转接头提前释放，气瓶重新排队",
      },
      ...prev,
    ]);
  }

  function cleanAdapter(adapterId: string) {
    const a = adapters.find((x) => x.id === adapterId);
    if (!a || a.status !== "DIRTY") return;
    if (!window.confirm(`确认转接头 ${adapterId} 已按氧气清洁 SOP 清洗复位？`)) return;
    setAdapters((prev) =>
      prev.map((x) => (x.id === adapterId ? { ...x, status: "FREE", heldBy: null } : x))
    );
  }

  function requeue(cylId: string) {
    setCylinders((prev) =>
      prev.map((x) =>
        x.id === cylId ? { ...x, status: "WAITING", adapterId: null, assignedAt: null } : x
      )
    );
  }

  function addCylinder(c: Cylinder) {
    setCylinders((prev) => [...prev, c]);
  }

  function addAdapter(a: Adapter) {
    setAdapters((prev) => [...prev, a]);
  }

  function resetDemo() {
    if (!window.confirm("清空当前调度数据并恢复演示数据？历史记录也会重置。")) return;
    const seed = seedState();
    setCylinders(seed.cylinders);
    setAdapters(seed.adapters);
    setHistory(seed.history);
  }

  /* ---------- 渲染 ---------- */

  return (
    <main className="app">
      <section className="hero">
        <p>hxyfront-62010 · 气瓶阀门适配器调度台 · Port 62010</p>
        <h1>气瓶阀门适配器调度台</h1>
        <span>
          按瓶阀螺纹、充填气体与清洁状态排队调度；同一转接头释放前不可分给第二瓶，氧气清洁转接头接触空气瓶后强制转入待清洗。
        </span>
        <div className="rule-strip">
          <span>🔒 占用互锁</span>
          <span>🫧 氧气清洁头防污染</span>
          <span>🚫 高氧 / Trimix 限氧气清洁头</span>
          <span>⛔ 检验过期禁止占用</span>
          <span>💾 刷新后状态保留</span>
        </div>
      </section>

      <section className="metrics">
        <article>
          <small>等待调度</small>
          <strong>{waiting.length}</strong>
          <em>瓶在队列中</em>
        </article>
        <article>
          <small>占用中转接头</small>
          <strong>{busyCount}</strong>
          <em>{filling.length} 瓶正在充填</em>
        </article>
        <article>
          <small>待清洗转接头</small>
          <strong className={dirtyCount ? "warn-num" : ""}>{dirtyCount}</strong>
          <em>清洗复位前停用</em>
        </article>
        <article>
          <small>过期锁定</small>
          <strong className={expiredCount ? "danger-num" : ""}>{expiredCount}</strong>
          <em>不得占用适配器</em>
        </article>
      </section>

      <section className="workspace dispatch-grid">
        <aside className="panel">
          <div className="heading">
            <div>
              <p>转接头池</p>
              <h2>适配器状态</h2>
            </div>
            <button className="ghost-btn" onClick={resetDemo}>重置演示</button>
          </div>
          <div className="adapter-pool">
            {THREAD_ORDER.map((t) => {
              const list = adapters.filter((a) => a.thread === t);
              if (list.length === 0) return null;
              return (
                <div key={t} className="adapter-group">
                  <h3>{THREAD_LABEL[t]}</h3>
                  {list.map((a) => (
                    <div key={a.id} className={`adapter-item status-${a.status.toLowerCase()}`}>
                      <div className="adapter-main">
                        <b>{a.id}</b>
                        <span className={`clean-tag clean-${a.clean.toLowerCase()}`}>
                          {CLEAN_LABEL[a.clean]}
                        </span>
                      </div>
                      <div className="adapter-side">
                        {a.status === "FREE" && <span className="status-tag free">空闲</span>}
                        {a.status === "BUSY" && (
                          <span className="status-tag busy">占用 · {a.heldBy}</span>
                        )}
                        {a.status === "DIRTY" && (
                          <>
                            <span className="status-tag dirty">待清洗</span>
                            <button className="mini-btn" onClick={() => cleanAdapter(a.id)}>
                              清洗复位
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
          <NewAdapterForm existingIds={adapters.map((a) => a.id)} onAdd={addAdapter} />
        </aside>

        <section className="panel queue-panel">
          {filling.length > 0 && (
            <>
              <div className="heading">
                <div>
                  <p>充填工位</p>
                  <h2>占用中 · 完成后释放转接头</h2>
                </div>
              </div>
              <div className="station-list">
                {filling.map((c) => (
                  <FillingCard
                    key={c.id}
                    cylinder={c}
                    adapter={adapters.find((a) => a.id === c.adapterId) ?? null}
                    onComplete={completeFill}
                    onRelease={releaseBack}
                  />
                ))}
              </div>
            </>
          )}

          <div className="heading queue-heading">
            <div>
              <p>待充填队列</p>
              <h2>
                按螺纹 → 气体 → 清洁状态排队
                {expiredCount > 0 && <span className="locked-pill">⛔ {expiredCount} 瓶过期锁定</span>}
              </h2>
            </div>
          </div>

          <div className="chips filter-chips">
            {([
              ["ALL", "全部"],
              ["AIR", "空气"],
              ["NITROX", "高氧"],
              ["TRIMIX", "Trimix"],
              ["EXPIRED", "过期锁定"],
            ] as [GasFilter, string][]).map(([key, label]) => (
              <button
                key={key}
                className={gasFilter === key ? "chip-active" : ""}
                onClick={() => setGasFilter(key)}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="queue-list">
            {queue.length === 0 && <p className="empty-hint">当前筛选下没有排队气瓶。</p>}
            {queue.map((c, idx) => (
              <QueueCard
                key={c.id}
                position={idx + 1}
                cylinder={c}
                candidates={adapters.filter((a) => adapterMatches(a, c))}
                onAssign={assignAdapter}
              />
            ))}
          </div>
        </section>
      </section>

      <section className="bottom-grid">
        <NewCylinderForm
          existingIds={cylinders.map((c) => c.id)}
          onAdd={addCylinder}
        />

        <section className="panel history-panel">
          <div className="heading">
            <div>
              <p>单瓶历史</p>
              <h2>气瓶充填档案</h2>
            </div>
          </div>
          <label className="history-select">
            <span>选择气瓶编号</span>
            <select value={historyCylId} onChange={(e) => setHistoryCylId(e.target.value)}>
              {cylinders
                .slice()
                .sort((a, b) => a.id.localeCompare(b.id))
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.id} · {gasBadge(c)} · {THREAD_LABEL[c.thread]}
                  </option>
                ))}
            </select>
          </label>
          <div className="history-list">
            {historyOf.length === 0 && <p className="empty-hint">该瓶暂无历史记录。</p>}
            {historyOf.map((h) => (
              <article key={h.id} className="history-item">
                <div className="history-top">
                  <b>{h.kind === "complete" ? "✅ 充填完成签收" : "↩️ 拆回释放"}</b>
                  <span>{formatTime(h.completedAt)}</span>
                </div>
                <p>
                  转接头 <b>{h.adapterId}</b>（{THREAD_LABEL[h.thread]}）· {GAS_LABEL[h.gas]} ·
                  操作员 <b>{h.operator}</b>
                </p>
                {h.startedAt && <p className="history-sub">开始占用：{formatTime(h.startedAt)}</p>}
                {h.note && <p className="history-note">{h.note}</p>}
              </article>
            ))}
          </div>

          {done.length > 0 && (
            <>
              <h3 className="done-title">已完成气瓶（{done.length}）</h3>
              <div className="done-list">
                {done.map((c) => (
                  <div key={c.id} className="done-item">
                    <span>
                      <b>{c.id}</b> · {gasBadge(c)} · {THREAD_LABEL[c.thread]}
                    </span>
                    <span className="done-actions">
                      <button className="mini-btn" onClick={() => setHistoryCylId(c.id)}>
                        历史
                      </button>
                      <button className="mini-btn" onClick={() => requeue(c.id)}>
                        重新排队
                      </button>
                    </span>
                  </div>
                ))}
              </div>
            </>
          )}
        </section>
      </section>
    </main>
  );
}

/* ================= 队列卡片 ================= */

function QueueCard({
  position,
  cylinder,
  candidates,
  onAssign,
}: {
  position: number;
  cylinder: Cylinder;
  candidates: Adapter[];
  onAssign: (cylId: string, adapterId: string) => void;
}) {
  const expired = isExpired(cylinder);
  const dleft = daysUntil(cylinder.inspection);
  const near = !expired && dleft <= 30;
  const mixAdvisory =
    cylinder.gas !== "AIR" && cylinder.clean !== "O2CLEAN";

  return (
    <article className={`queue-card ${expired ? "locked" : ""}`}>
      <div className="queue-index">
        <b>{String(position).padStart(2, "0")}</b>
      </div>
      <div className="queue-body">
        <div className="queue-head">
          <h3>
            {cylinder.id}
            <span className="vol-tag">{cylinder.volume}</span>
          </h3>
          <div className="badge-row">
            <span className="badge-thread">{THREAD_LABEL[cylinder.thread]}</span>
            <span className={`badge-gas gas-${cylinder.gas.toLowerCase()}`}>{gasBadge(cylinder)}</span>
            <span className={`clean-tag clean-${cylinder.clean.toLowerCase()}`}>
              {CLEAN_LABEL[cylinder.clean]}
            </span>
            {expired ? (
              <span className="status-tag dirty">⛔ 检验过期 {Math.abs(dleft)} 天 · 锁定</span>
            ) : near ? (
              <span className="status-tag warn">检验仅剩 {dleft} 天</span>
            ) : (
              <span className="status-tag ok">检验有效至 {cylinder.inspection}</span>
            )}
          </div>
        </div>

        <p className="queue-meta">
          残压 {cylinder.residual}bar → 目标 {cylinder.target}bar
          {cylinder.gas === "NITROX" && <> · MOD {modMeter(cylinder.o2)}m（pO₂ 1.4）</>}
          {cylinder.gas === "TRIMIX" && (
            <>
              {" "}· MOD {modMeter(cylinder.o2)}m · END {endMeter(cylinder.o2, cylinder.he)}m
            </>
          )}
        </p>
        {mixAdvisory && (
          <p className="mix-advisory">
            ⚠️ 该瓶非氧气清洁等级却申请 {GAS_LABEL[cylinder.gas]}，请先按店内 SOP 确认气瓶合规，再使用氧气清洁转接头。
          </p>
        )}

        <div className="assign-row">
          {expired ? (
            <span className="assign-locked">⛔ 检验过期瓶不得占用任何适配器，请先送检。</span>
          ) : candidates.length === 0 ? (
            <span className="assign-none">
              暂无可分配的同螺纹氧气清洁 / 空闲转接头，等待释放或清洗复位。
            </span>
          ) : (
            <>
              <span className="assign-label">分配转接头：</span>
              {candidates.map((a) => (
                <button
                  key={a.id}
                  className={`assign-btn ${a.clean === "O2CLEAN" && cylinder.gas === "AIR" ? "assign-risk" : ""}`}
                  onClick={() => onAssign(cylinder.id, a.id)}
                  title={
                    a.clean === "O2CLEAN" && cylinder.gas === "AIR"
                      ? "氧气清洁头接触空气瓶，完成后将强制转待清洗"
                      : `分配 ${a.id}`
                  }
                >
                  {a.id}
                  <small>{CLEAN_LABEL[a.clean]}</small>
                  {a.clean === "O2CLEAN" && cylinder.gas === "AIR" && (
                    <i className="risk-flag">用后待清洗</i>
                  )}
                </button>
              ))}
            </>
          )}
        </div>
      </div>
    </article>
  );
}

/* ================= 充填工位卡片 ================= */

function FillingCard({
  cylinder,
  adapter,
  onComplete,
  onRelease,
}: {
  cylinder: Cylinder;
  adapter: Adapter | null;
  onComplete: (cylId: string, operator: string) => void;
  onRelease: (cylId: string) => void;
}) {
  const [operator, setOperator] = useState("");
  const [touched, setTouched] = useState(false);

  return (
    <article className="station-card">
      <div className="station-info">
        <h3>
          {cylinder.id} <span className="vol-tag">{cylinder.volume}</span>
        </h3>
        <p>
          <span className={`badge-gas gas-${cylinder.gas.toLowerCase()}`}>{gasBadge(cylinder)}</span>
          {" · "}
          {THREAD_LABEL[cylinder.thread]} · {CLEAN_LABEL[cylinder.clean]}瓶 · 残压
          {" "}{cylinder.residual}bar → {cylinder.target}bar
        </p>
        <p className="station-adapter">
          🔒 占用转接头 <b>{adapter?.id ?? "—"}</b>
          {adapter && <>（{CLEAN_LABEL[adapter.clean]}）</>} · 自 {formatTime(cylinder.assignedAt)} 起不可再分
        </p>
      </div>
      <div className="station-actions">
        <input
          placeholder="操作员姓名 / 工号（签收）"
          value={operator}
          onChange={(e) => setOperator(e.target.value)}
          onBlur={() => setTouched(true)}
        />
        {touched && !operator.trim() && <small className="field-error">签收需要填写操作员</small>}
        <div className="station-btns">
          <button
            className="primary"
            disabled={!operator.trim()}
            onClick={() => onComplete(cylinder.id, operator)}
          >
            完成充填并释放
          </button>
          <button className="ghost-btn" onClick={() => onRelease(cylinder.id)}>
            拆回排队
          </button>
        </div>
        {adapter?.clean === "O2CLEAN" && cylinder.gas === "AIR" && (
          <p className="dirty-warning">
            🫧 氧气清洁头已接触空气瓶：无论签收还是拆回，{adapter.id} 都将强制转入待清洗，清洗复位前不得用于高氧 / Trimix。
          </p>
        )}
      </div>
    </article>
  );
}

/* ================= 新增气瓶表单 ================= */

function NewCylinderForm({
  existingIds,
  onAdd,
}: {
  existingIds: string[];
  onAdd: (c: Cylinder) => void;
}) {
  const [form, setForm] = useState({
    id: "",
    volume: "12L 钢瓶",
    inspection: todayStr(),
    residual: "50",
    target: "200",
    thread: "DIN" as Thread,
    gas: "AIR" as Gas,
    clean: "GENERAL" as CleanLevel,
    o2: "21",
    he: "0",
  });
  const [error, setError] = useState("");

  function update<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((prev) => {
      const next = { ...prev, [key]: value };
      // 气体变化时给出默认配比
      if (key === "gas") {
        if (value === "AIR") { next.o2 = "21"; next.he = "0"; }
        if (value === "NITROX") { next.o2 = "32"; next.he = "0"; }
        if (value === "TRIMIX") { next.o2 = "18"; next.he = "45"; }
      }
      return next;
    });
  }

  function submit() {
    const id = form.id.trim().toUpperCase();
    if (!id) return setError("请填写气瓶编号");
    if (existingIds.includes(id)) return setError(`气瓶编号 ${id} 已存在`);
    if (!form.inspection) return setError("请选择检验有效期");
    const o2 = Number(form.o2);
    const he = Number(form.he);
    if (form.gas !== "AIR" && (o2 <= 21 || o2 >= 100)) return setError("高氧 / Trimix 氧含量需在 22–99 之间");
    if (form.gas === "TRIMIX" && (he < 1 || o2 + he >= 100)) return setError("Trimix 氦含量需 ≥1 且 O₂+He<100");

    onAdd({
      id,
      volume: form.volume.trim() || "未注明",
      inspection: form.inspection,
      residual: Number(form.residual) || 0,
      target: Number(form.target) || 0,
      thread: form.thread,
      gas: form.gas,
      clean: form.clean,
      o2,
      he,
      status: "WAITING",
      adapterId: null,
      assignedAt: null,
    });
    setForm({ ...form, id: "", o2: form.gas === "AIR" ? "21" : form.o2 });
    setError("");
  }

  return (
    <section className="panel form-panel">
      <div className="heading">
        <div>
          <p>进站登记</p>
          <h2>新增排队气瓶</h2>
        </div>
      </div>
      <div className="field-grid">
        <label>
          <span>气瓶编号</span>
          <input placeholder="如 TANK-277" value={form.id} onChange={(e) => update("id", e.target.value)} />
        </label>
        <label>
          <span>容积 / 规格</span>
          <input value={form.volume} onChange={(e) => update("volume", e.target.value)} />
        </label>
        <label>
          <span>检验有效期</span>
          <input type="date" value={form.inspection} onChange={(e) => update("inspection", e.target.value)} />
        </label>
        <label>
          <span>瓶阀螺纹</span>
          <select value={form.thread} onChange={(e) => update("thread", e.target.value as Thread)}>
            {THREAD_ORDER.map((t) => (
              <option key={t} value={t}>{THREAD_LABEL[t]}</option>
            ))}
          </select>
        </label>
        <label>
          <span>充填气体</span>
          <select value={form.gas} onChange={(e) => update("gas", e.target.value as Gas)}>
            <option value="AIR">空气</option>
            <option value="NITROX">高氧</option>
            <option value="TRIMIX">Trimix</option>
          </select>
        </label>
        <label>
          <span>清洁状态</span>
          <select value={form.clean} onChange={(e) => update("clean", e.target.value as CleanLevel)}>
            {CLEAN_ORDER.map((c) => (
              <option key={c} value={c}>{CLEAN_LABEL[c]}</option>
            ))}
          </select>
        </label>
        <label>
          <span>残压 (bar)</span>
          <input type="number" value={form.residual} onChange={(e) => update("residual", e.target.value)} />
        </label>
        <label>
          <span>目标压力 (bar)</span>
          <input type="number" value={form.target} onChange={(e) => update("target", e.target.value)} />
        </label>
        {form.gas !== "AIR" && (
          <>
            <label>
              <span>氧含量 O₂ (%)</span>
              <input type="number" value={form.o2} onChange={(e) => update("o2", e.target.value)} />
            </label>
            <label>
              <span>氦含量 He (%){form.gas === "NITROX" ? " · 高氧固定 0" : ""}</span>
              <input
                type="number"
                value={form.he}
                disabled={form.gas === "NITROX"}
                onChange={(e) => update("he", e.target.value)}
              />
            </label>
          </>
        )}
      </div>
      {form.gas !== "AIR" && (
        <p className="mix-hint">
          {form.gas === "NITROX"
            ? `EAN${Number(form.o2) || 0} · MOD 约 ${modMeter(Number(form.o2) || 0)}m（pO₂ 上限 1.4）`
            : `Tx ${Number(form.o2) || 0}/${Number(form.he) || 0} · MOD 约 ${modMeter(Number(form.o2) || 0)}m · END 约 ${endMeter(Number(form.o2) || 0, Number(form.he) || 0)}m`}
        </p>
      )}
      {error && <p className="field-error">{error}</p>}
      <button className="primary submit-btn" onClick={submit}>排入队列</button>
    </section>
  );
}

/* ================= 新增转接头表单 ================= */

function NewAdapterForm({
  existingIds,
  onAdd,
}: {
  existingIds: string[];
  onAdd: (a: Adapter) => void;
}) {
  const [id, setId] = useState("");
  const [thread, setThread] = useState<Thread>("DIN");
  const [clean, setClean] = useState<CleanLevel>("GENERAL");
  const [error, setError] = useState("");

  function submit() {
    const nextId = id.trim().toUpperCase();
    if (!nextId) return setError("请填写转接头编号");
    if (existingIds.includes(nextId)) return setError(`转接头 ${nextId} 已存在`);
    onAdd({ id: nextId, thread, clean, status: "FREE", heldBy: null });
    setId("");
    setError("");
  }

  return (
    <div className="new-adapter">
      <h3>登记新转接头</h3>
      <label>
        <span>转接头编号</span>
        <input placeholder="如 ADP-07" value={id} onChange={(e) => setId(e.target.value)} />
      </label>
      <label>
        <span>瓶阀螺纹</span>
        <select value={thread} onChange={(e) => setThread(e.target.value as Thread)}>
          {THREAD_ORDER.map((t) => (
            <option key={t} value={t}>{THREAD_LABEL[t]}</option>
          ))}
        </select>
      </label>
      <label>
        <span>清洁等级</span>
        <select value={clean} onChange={(e) => setClean(e.target.value as CleanLevel)}>
          {CLEAN_ORDER.map((c) => (
            <option key={c} value={c}>{CLEAN_LABEL[c]}</option>
          ))}
        </select>
      </label>
      {error && <p className="field-error">{error}</p>}
      <button className="primary" onClick={submit}>加入转接头池</button>
    </div>
  );
}

export default App;
