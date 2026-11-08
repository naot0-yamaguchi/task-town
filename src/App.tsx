import React, { useEffect, useState } from 'react';
import {
  Zap,
  Plus,
  CheckCircle2,
  Circle,
  Trash2,
  Sparkles,
  Rocket,
  Download,
  Upload,
  Cpu,
  Shield,
  Sun,
  Trees,
  Radio,
  Building2,
} from 'lucide-react';
import { db, initializeDatabase, type GridTile, type PlayerStats, type TaskDifficulty, type TaskItem } from './db';

// 建設可能なSF施設カタログ
interface BuildingDef {
  id: string;
  name: string;
  cost: number;
  xpBonus: number;
  description: string;
  color: string;
  glow: string;
  icon: React.ReactNode;
}

const BUILDINGS: BuildingDef[] = [
  {
    id: 'command_hub',
    name: '司令コア',
    cost: 0,
    xpBonus: 100,
    description: 'コロニーの中枢モジュール',
    color: 'from-cyan-500 to-blue-600',
    glow: 'shadow-[0_0_15px_rgba(6,182,212,0.5)]',
    icon: <Cpu className="w-6 h-6 text-white" />,
  },
  {
    id: 'solar_array',
    name: 'ソーラーパネル',
    cost: 50,
    xpBonus: 30,
    description: '基本電力を供給する発電アレイ',
    color: 'from-amber-400 to-orange-600',
    glow: 'shadow-[0_0_12px_rgba(245,158,11,0.45)]',
    icon: <Sun className="w-6 h-6 text-white" />,
  },
  {
    id: 'bio_dome',
    name: 'バイオドーム',
    cost: 100,
    xpBonus: 70,
    description: '酸素と食料を生み出す緑化ドーム',
    color: 'from-emerald-400 to-teal-600',
    glow: 'shadow-[0_0_14px_rgba(16,185,129,0.45)]',
    icon: <Trees className="w-6 h-6 text-white" />,
  },
  {
    id: 'hab_tower',
    name: '居住タワー',
    cost: 180,
    xpBonus: 140,
    description: '開拓民が暮らす高層居住区画',
    color: 'from-indigo-400 to-purple-600',
    glow: 'shadow-[0_0_15px_rgba(129,140,248,0.5)]',
    icon: <Building2 className="w-6 h-6 text-white" />,
  },
  {
    id: 'comms_radar',
    name: '深宇宙レーダー',
    cost: 300,
    xpBonus: 260,
    description: '未知の星系と交信する大型アンテナ',
    color: 'from-pink-500 to-rose-600',
    glow: 'shadow-[0_0_16px_rgba(244,63,94,0.55)]',
    icon: <Radio className="w-6 h-6 text-white" />,
  },
  {
    id: 'orbital_elevator',
    name: '軌道エレベーター',
    cost: 500,
    xpBonus: 500,
    description: '宇宙と地上を結ぶ超巨大建造物',
    color: 'from-sky-300 via-cyan-400 to-indigo-500',
    glow: 'shadow-[0_0_20px_rgba(56,189,248,0.75)]',
    icon: <Rocket className="w-6 h-6 text-white" />,
  },
];

const DIFFICULTY_CONFIG: Record<TaskDifficulty, { label: string; ep: number; xp: number; badge: string }> = {
  easy: { label: '軽作業', ep: 30, xp: 20, badge: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40' },
  normal: { label: '通常', ep: 60, xp: 50, badge: 'bg-cyan-500/20 text-cyan-300 border-cyan-500/40' },
  hard: { label: '重要', ep: 120, xp: 110, badge: 'bg-amber-500/20 text-amber-300 border-amber-500/40' },
};

const getNow = () => Date.now();

// 心地よい電子SEを鳴らす簡易シンセ（外部音声ファイル不要）
function playSynthSound(type: 'complete' | 'build') {
  try {
    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new AudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);

    const now = ctx.currentTime;
    if (type === 'complete') {
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(523.25, now); // C5
      osc.frequency.setValueAtTime(659.25, now + 0.07); // E5
      osc.frequency.setValueAtTime(1046.5, now + 0.14); // C6
      gain.gain.setValueAtTime(0.12, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.35);
      osc.start(now);
      osc.stop(now + 0.35);
    } else {
      osc.type = 'sine';
      osc.frequency.setValueAtTime(220, now);
      osc.frequency.exponentialRampToValueAtTime(880, now + 0.25);
      gain.gain.setValueAtTime(0.15, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.3);
      osc.start(now);
      osc.stop(now + 0.3);
    }
  } catch {
    // 音声再生ブロック時は無視
  }
}

export default function App() {
  const [stats, setStats] = useState<PlayerStats>({ id: 1, ep: 150, xp: 0, completedCount: 0 });
  const [tiles, setTiles] = useState<GridTile[]>([]);
  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const [selectedTileIndex, setSelectedTileIndex] = useState<number | null>(null);
  const [newTaskTitle, setNewTaskTitle] = useState('');
  const [newTaskDiff, setNewTaskDiff] = useState<TaskDifficulty>('normal');
  const [toast, setToast] = useState<string | null>(null);
  const [showBackupModal, setShowBackupModal] = useState(false);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2200);
  };

  const loadAll = async () => {
    await initializeDatabase();
    const [s, tList, taskList] = await Promise.all([
      db.stats.get(1),
      db.tiles.orderBy('index').toArray(),
      db.tasks.orderBy('createdAt').reverse().toArray(),
    ]);
    if (s) setStats(s);
    setTiles(tList);
    setTasks(taskList);
  };

  useEffect(() => {
    let ignore = false;
    (async () => {
      await initializeDatabase();
      const [s, tList, taskList] = await Promise.all([
        db.stats.get(1),
        db.tiles.orderBy('index').toArray(),
        db.tasks.orderBy('createdAt').reverse().toArray(),
      ]);
      if (!ignore) {
        if (s) setStats(s);
        setTiles(tList);
        setTasks(taskList);
      }
    })();
    return () => {
      ignore = true;
    };
  }, []);

  // レベル計算
  const level = Math.floor(Math.sqrt(stats.xp / 50)) + 1;
  const currentLevelXp = Math.pow(level - 1, 2) * 50;
  const nextLevelXp = Math.pow(level, 2) * 50;
  const levelProgress = Math.min(100, Math.max(0, ((stats.xp - currentLevelXp) / (nextLevelXp - currentLevelXp)) * 100));

  // タスク追加
  const handleAddTask = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTaskTitle.trim()) return;
    await db.tasks.add({
      title: newTaskTitle.trim(),
      difficulty: newTaskDiff,
      completed: false,
      createdAt: getNow(),
    });
    setNewTaskTitle('');
    await loadAll();
  };

  // タスク完了処理
  const handleCompleteTask = async (task: TaskItem) => {
    if (!task.id || task.completed) return;
    const reward = DIFFICULTY_CONFIG[task.difficulty];
    playSynthSound('complete');

    await db.tasks.update(task.id, { completed: true, completedAt: getNow() });
    await db.stats.update(1, {
      ep: stats.ep + reward.ep,
      xp: stats.xp + reward.xp,
      completedCount: stats.completedCount + 1,
    });
    showToast(`+${reward.ep} EP / +${reward.xp} XP 獲得！`);
    await loadAll();
  };

  // タスク削除
  const handleDeleteTask = async (id?: number) => {
    if (!id) return;
    await db.tasks.delete(id);
    await loadAll();
  };

  // 施設建設
  const handleBuild = async (building: BuildingDef) => {
    if (selectedTileIndex === null) return;
    if (stats.ep < building.cost) {
      showToast('エネルギー(EP)が不足しています');
      return;
    }

    playSynthSound('build');
    await db.tiles.put({ index: selectedTileIndex, buildingId: building.id });
    await db.stats.update(1, {
      ep: stats.ep - building.cost,
      xp: stats.xp + building.xpBonus,
    });
    showToast(`${building.name} を建設しました！`);
    setSelectedTileIndex(null);
    await loadAll();
  };

  // 施設撤去
  const handleDemolish = async () => {
    if (selectedTileIndex === null) return;
    await db.tiles.put({ index: selectedTileIndex, buildingId: null });
    setSelectedTileIndex(null);
    showToast('区画を更地に戻しました');
    await loadAll();
  };

  // JSONバックアップ出力
  const handleExportJSON = async () => {
    const data = {
      stats: await db.stats.toArray(),
      tiles: await db.tiles.toArray(),
      tasks: await db.tasks.toArray(),
      exportedAt: new Date().toISOString(),
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `task-town-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // JSONバックアップ復元
  const handleImportJSON = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      if (data.stats) await db.stats.bulkPut(data.stats);
      if (data.tiles) await db.tiles.bulkPut(data.tiles);
      if (data.tasks) {
        await db.tasks.clear();
        await db.tasks.bulkAdd(data.tasks);
      }
      await loadAll();
      setShowBackupModal(false);
      showToast('データを復元しました');
    } catch {
      showToast('バックアップファイルの読み込みに失敗しました');
    }
  };

  const activeTasks = tasks.filter((t) => !t.completed);
  const completedTasks = tasks.filter((t) => t.completed).slice(0, 10);
  const selectedTile = selectedTileIndex !== null ? tiles.find((t) => t.index === selectedTileIndex) : null;

  return (
    <div className="min-h-dvh bg-[#060b19] text-slate-100 flex flex-col max-w-md mx-auto relative overflow-x-hidden pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]">
      {/* 背景のサイバーグリッド装飾 */}
      <div
        className="fixed inset-0 pointer-events-none opacity-20"
        style={{
          backgroundImage:
            'radial-gradient(circle at 50% 15%, rgba(6, 182, 212, 0.25), transparent 60%), linear-gradient(to right, rgba(30, 41, 59, 0.5) 1px, transparent 1px), linear-gradient(to bottom, rgba(30, 41, 59, 0.5) 1px, transparent 1px)',
          backgroundSize: '100% 100%, 24px 24px, 24px 24px',
        }}
      />

      {/* トースト通知 */}
      {toast && (
        <div className="fixed top-14 left-1/2 -translate-x-1/2 z-50 bg-cyan-950/90 border border-cyan-400/60 text-cyan-200 px-4 py-2 rounded-full text-xs font-bold tracking-wider shadow-[0_0_20px_rgba(6,182,212,0.5)] flex items-center gap-1.5 animate-bounce">
          <Sparkles className="w-3.5 h-3.5 text-cyan-400" />
          {toast}
        </div>
      )}

      {/* ヘッダー：コロニーレベル＆エネルギー残高 */}
      <header className="relative z-10 px-4 pt-3 pb-2 flex items-center justify-between border-b border-slate-800/80 bg-slate-950/60 backdrop-blur-md">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-mono uppercase tracking-widest text-cyan-400 bg-cyan-950/80 border border-cyan-500/30 px-2 py-0.5 rounded">
              SECTOR-01
            </span>
            <span className="text-sm font-bold tracking-wide text-white">LV.{level} コロニー</span>
          </div>
          {/* XPプログレスバー */}
          <div className="w-36 h-1.5 bg-slate-800 rounded-full mt-1.5 overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-cyan-400 to-indigo-500 transition-all duration-500"
              style={{ width: `${levelProgress}%` }}
            />
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* EP (エネルギーポイント) */}
          <div className="bg-amber-500/10 border border-amber-500/40 px-3 py-1.5 rounded-xl flex items-center gap-1.5 shadow-[0_0_12px_rgba(245,158,11,0.15)]">
            <Zap className="w-4 h-4 text-amber-400 fill-amber-400" />
            <span className="font-mono font-bold text-amber-300 text-sm">{stats.ep}</span>
            <span className="text-[10px] text-amber-400/80 font-mono">EP</span>
          </div>

          <button
            onClick={() => setShowBackupModal(true)}
            className="p-2 rounded-xl bg-slate-900 border border-slate-700/70 text-slate-400 hover:text-cyan-400"
            aria-label="バックアップ"
          >
            <Shield className="w-4 h-4" />
          </button>
        </div>
      </header>

      {/* 箱庭コロニーエリア (6x6 グリッド) */}
      <section className="relative z-10 px-4 py-3">
        <div className="flex items-center justify-between mb-2">
          <span className="text-[11px] font-mono text-slate-400 tracking-wider">
            COLONY GRID // マスをタップして建設
          </span>
          <span className="text-[11px] font-mono text-cyan-400">
            施設数: {tiles.filter((t) => t.buildingId).length} / 36
          </span>
        </div>

        <div className="bg-slate-900/80 border border-cyan-500/25 rounded-2xl p-2.5 shadow-[0_0_30px_rgba(6,182,212,0.1)] backdrop-blur-sm">
          <div className="grid grid-cols-6 gap-1.5 aspect-square">
            {tiles.map((tile) => {
              const building = BUILDINGS.find((b) => b.id === tile.buildingId);
              const isSelected = selectedTileIndex === tile.index;

              return (
                <button
                  key={tile.index}
                  onClick={() => setSelectedTileIndex(isSelected ? null : tile.index)}
                  className={`relative rounded-xl flex items-center justify-center transition-all duration-200 active:scale-90 ${
                    isSelected
                      ? 'ring-2 ring-cyan-300 bg-cyan-500/20 scale-105 z-10'
                      : building
                        ? `bg-gradient-to-br ${building.color} ${building.glow}`
                        : 'bg-slate-800/50 border border-slate-700/40 hover:border-cyan-500/40'
                  }`}
                >
                  {building ? (
                    <div className="flex flex-col items-center justify-center">
                      {building.icon}
                    </div>
                  ) : (
                    <span className="w-1 h-1 rounded-full bg-slate-600/60" />
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* タイル選択時の建設ドロワー */}
        {selectedTile && (
          <div className="mt-2.5 bg-slate-900/95 border border-cyan-500/40 rounded-2xl p-3 shadow-xl animate-fadeIn">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-bold text-cyan-300">
                区画 #{selectedTile.index + 1} の開発メニュー
              </span>
              {selectedTile.buildingId && selectedTile.buildingId !== 'command_hub' && (
                <button
                  onClick={handleDemolish}
                  className="text-[11px] text-rose-400 hover:text-rose-300 flex items-center gap-1"
                >
                  <Trash2 className="w-3 h-3" /> 撤去する
                </button>
              )}
            </div>

            <div className="grid grid-cols-3 gap-2">
              {BUILDINGS.filter((b) => b.id !== 'command_hub').map((b) => {
                const canAfford = stats.ep >= b.cost;
                return (
                  <button
                    key={b.id}
                    onClick={() => handleBuild(b)}
                    disabled={!canAfford}
                    className={`p-2 rounded-xl border text-left flex flex-col justify-between transition-all ${
                      canAfford
                        ? 'bg-slate-800/90 border-slate-700 hover:border-cyan-400 active:scale-95'
                        : 'bg-slate-950/60 border-slate-800/50 opacity-45 cursor-not-allowed'
                    }`}
                  >
                    <div className={`w-7 h-7 rounded-lg bg-gradient-to-br ${b.color} flex items-center justify-center mb-1.5`}>
                      {b.icon}
                    </div>
                    <div className="text-[11px] font-bold text-slate-100 leading-tight">{b.name}</div>
                    <div className="text-[10px] font-mono text-amber-400 mt-1 flex items-center gap-0.5">
                      <Zap className="w-2.5 h-2.5 fill-amber-400" />
                      {b.cost} EP
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </section>

      {/* タスク管理エリア */}
      <section className="relative z-10 flex-1 px-4 pb-6 flex flex-col">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-xs font-mono tracking-wider text-slate-300 uppercase">
            MISSIONS // タスク消化でエネルギー生成
          </h2>
          <span className="text-[11px] text-slate-400 font-mono">完了計: {stats.completedCount}</span>
        </div>

        {/* タスク入力フォーム */}
        <form onSubmit={handleAddTask} className="bg-slate-900/90 border border-slate-700/80 rounded-2xl p-2 mb-3">
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={newTaskTitle}
              onChange={(e) => setNewTaskTitle(e.target.value)}
              placeholder="新しいミッションを入力..."
              className="flex-1 bg-transparent text-sm text-white placeholder-slate-500 px-2 py-1.5 focus:outline-none"
            />
            <button
              type="submit"
              disabled={!newTaskTitle.trim()}
              className="bg-cyan-500 hover:bg-cyan-400 disabled:bg-slate-800 disabled:text-slate-600 text-slate-950 font-bold p-2 rounded-xl transition-colors"
            >
              <Plus className="w-5 h-5" />
            </button>
          </div>

          {/* 難易度（報酬量）セレクター */}
          <div className="flex items-center gap-1.5 mt-2 pt-2 border-t border-slate-800/80 px-1">
            <span className="text-[10px] text-slate-400 mr-1">報酬規模:</span>
            {(['easy', 'normal', 'hard'] as TaskDifficulty[]).map((diff) => {
              const cfg = DIFFICULTY_CONFIG[diff];
              const active = newTaskDiff === diff;
              return (
                <button
                  key={diff}
                  type="button"
                  onClick={() => setNewTaskDiff(diff)}
                  className={`text-[10px] px-2.5 py-1 rounded-lg border font-medium transition-all ${
                    active ? cfg.badge : 'bg-slate-950/50 text-slate-500 border-slate-800'
                  }`}
                >
                  {cfg.label} (+{cfg.ep}EP)
                </button>
              );
            })}
          </div>
        </form>

        {/* 未完了タスク一覧 */}
        <div className="space-y-2">
          {activeTasks.length === 0 ? (
            <div className="text-center py-6 text-xs text-slate-500 border border-dashed border-slate-800 rounded-2xl">
              進行中のミッションはありません。タスクを追加して開拓を進めましょう！
            </div>
          ) : (
            activeTasks.map((task) => {
              const cfg = DIFFICULTY_CONFIG[task.difficulty];
              return (
                <div
                  key={task.id}
                  className="bg-slate-900/75 border border-slate-800 hover:border-cyan-500/40 rounded-xl p-3 flex items-center justify-between gap-3 transition-all"
                >
                  <button
                    onClick={() => handleCompleteTask(task)}
                    className="flex items-center gap-3 flex-1 text-left group"
                  >
                    <Circle className="w-5 h-5 text-cyan-400 group-hover:scale-110 transition-transform shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-slate-100 font-medium truncate">{task.title}</p>
                      <span className={`inline-block text-[10px] px-1.5 py-0.5 rounded border mt-1 ${cfg.badge}`}>
                        {cfg.label} • +{cfg.ep} EP
                      </span>
                    </div>
                  </button>
                  <button
                    onClick={() => handleDeleteTask(task.id)}
                    className="text-slate-600 hover:text-rose-400 p-1"
                    aria-label="削除"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              );
            })
          )}
        </div>

        {/* 最近完了したタスク */}
        {completedTasks.length > 0 && (
          <div className="mt-5">
            <div className="text-[10px] font-mono text-slate-500 mb-2">COMPLETED LOG (最新10件)</div>
            <div className="space-y-1.5 opacity-60">
              {completedTasks.map((task) => (
                <div
                  key={task.id}
                  className="bg-slate-900/40 border border-slate-800/60 rounded-lg px-3 py-2 flex items-center justify-between text-xs"
                >
                  <div className="flex items-center gap-2 truncate">
                    <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
                    <span className="line-through text-slate-400 truncate">{task.title}</span>
                  </div>
                  <button onClick={() => handleDeleteTask(task.id)} className="text-slate-600 hover:text-rose-400 ml-2">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </section>

      {/* バックアップモーダル */}
      {showBackupModal && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl p-5 max-w-sm w-full">
            <h3 className="text-sm font-bold text-white mb-1">データバックアップ / 復元</h3>
            <p className="text-xs text-slate-400 mb-4">
              データはiPhoneのブラウザ内に保存されています。機種変更やキャッシュ削除に備えてJSONファイルで保存できます。
            </p>
            <div className="space-y-2.5">
              <button
                onClick={handleExportJSON}
                className="w-full py-2.5 px-4 rounded-xl bg-cyan-500 text-slate-950 font-bold text-xs flex items-center justify-center gap-2"
              >
                <Download className="w-4 h-4" /> バックアップを保存 (JSON)
              </button>
              <label className="w-full py-2.5 px-4 rounded-xl bg-slate-800 border border-slate-700 text-slate-200 font-bold text-xs flex items-center justify-center gap-2 cursor-pointer">
                <Upload className="w-4 h-4" /> バックアップから復元
                <input type="file" accept=".json" onChange={handleImportJSON} className="hidden" />
              </label>
            </div>
            <button
              onClick={() => setShowBackupModal(false)}
              className="w-full mt-4 py-2 text-xs text-slate-400 hover:text-white"
            >
              閉じる
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
