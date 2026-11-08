import Dexie, { type Table } from 'dexie';

export type TaskDifficulty = 'easy' | 'normal' | 'hard';

export interface TaskItem {
  id?: number;
  title: string;
  difficulty: TaskDifficulty;
  completed: boolean;
  createdAt: number;
  completedAt?: number;
}

export interface GridTile {
  index: number; // 0 〜 35 (6x6)
  buildingId: string | null;
}

export interface PlayerStats {
  id: number; // 常に 1
  ep: number; // Energy Points (建設コスト)
  xp: number; // 総経験値
  completedCount: number;
}

class TaskTownDB extends Dexie {
  tasks!: Table<TaskItem, number>;
  tiles!: Table<GridTile, number>;
  stats!: Table<PlayerStats, number>;

  constructor() {
    super('TaskTownSFDB');
    this.version(1).stores({
      tasks: '++id, completed, createdAt',
      tiles: 'index',
      stats: 'id',
    });
  }
}

export const db = new TaskTownDB();

// 初期データ投入
export async function initializeDatabase() {
  const stats = await db.stats.get(1);
  if (!stats) {
    await db.stats.put({ id: 1, ep: 150, xp: 0, completedCount: 0 });
  }

  const tileCount = await db.tiles.count();
  if (tileCount === 0) {
    const initialTiles: GridTile[] = Array.from({ length: 36 }, (_, i) => ({
      index: i,
      // 中央に初期司令基地を1つ配置
      buildingId: i === 14 ? 'command_hub' : null,
    }));
    await db.tiles.bulkPut(initialTiles);
  }

  const taskCount = await db.tasks.count();
  if (taskCount === 0) {
    await db.tasks.bulkAdd([
      { title: '最初のタスクを完了してエネルギーを得る', difficulty: 'easy', completed: false, createdAt: Date.now() },
      { title: '空きマスをタップして施設を建設する', difficulty: 'normal', completed: false, createdAt: Date.now() + 1 },
    ]);
  }
}
