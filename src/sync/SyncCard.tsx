/**
 * 云端同步卡片（§4.6），放在数据页。
 * 状态来自 cloud.ts 的订阅，页面自己不发请求 —— 自动同步由 App 启动时挂的钩子驱动。
 */
import { useEffect, useState } from 'react';
import Icon from '../ui/Icon';
import {
  changePassphrase,
  clearPassphrase,
  getPassphrase,
  getSyncStatus,
  newPassphrase,
  setAutoSync,
  spaceIdOf,
  subscribeSync,
  syncNow,
} from './cloud';
import type { SyncStatus } from './cloud';

export default function SyncCard() {
  const [st, setSt] = useState<SyncStatus>(getSyncStatus);
  const [pass, setPass] = useState(() => getPassphrase());
  const [shown, setShown] = useState(false);
  const [spaceId, setSpaceId] = useState('');
  const [deleteOld, setDeleteOld] = useState(true);
  const [err, setErr] = useState('');

  useEffect(() => subscribeSync(setSt), []);
  useEffect(() => {
    const p = getPassphrase();
    if (!p) {
      setSpaceId('');
      return;
    }
    void spaceIdOf(p).then(setSpaceId);
  }, [st.lastAt, st.rev]);

  const saved = getPassphrase();
  const dirty = pass.trim() !== saved;

  async function save() {
    setErr('');
    try {
      if (pass.trim()) await changePassphrase(pass, { deleteOld });
      else await clearPassphrase();
      setSpaceId('');
      const p = getPassphrase();
      if (p) setSpaceId(await spaceIdOf(p));
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <div className="kd-card px-3.5 py-3 text-[12px]">
      {/* 状态行 */}
      <div className="flex flex-wrap items-center gap-2">
        <span
          className={`h-2 w-2 shrink-0 rounded-full ${!st.configured ? 'bg-line-2' : st.running ? 'bg-line-2' : st.ok ? 'bg-travel' : 'bg-danger'}`}
        />
        <span className="shrink-0 font-medium text-ink-2">云端同步</span>
        <span className="min-w-0 flex-1 truncate text-ink-3" title={st.detail}>
          {st.running ? '同步中…' : st.configured ? st.detail || '未同步' : '未设置空间口令，数据只在本浏览器'}
          {spaceId && <span className="ml-1.5 font-mono text-[11px]">#{spaceId}</span>}
        </span>
        <label className="flex shrink-0 items-center gap-1.5 text-ink-3">
          <input
            type="checkbox"
            checked={st.auto}
            onChange={(e) => setAutoSync(e.target.checked)}
            className="h-3.5 w-3.5 accent-[var(--color-food)]"
          />
          自动
        </label>
        <button
          onClick={() => void syncNow()}
          disabled={st.running || !saved}
          className="kd-btn kd-btn-ghost !px-2.5 !py-1 text-[12px]"
        >
          立即同步
        </button>
      </div>

      {/* 口令 */}
      <div className="mt-2.5 flex flex-wrap items-center gap-2">
        <input
          type={shown ? 'text' : 'password'}
          value={pass}
          onChange={(e) => setPass(e.target.value)}
          placeholder="空间口令（当密码保管，丢了云上数据就找不回）"
          className="kd-input min-w-0 flex-1 !px-2 !py-1 font-mono text-[11.5px]"
        />
        <button onClick={() => setShown((v) => !v)} className="kd-btn kd-btn-ghost !px-2.5 !py-1 text-[12px]">
          {shown ? '隐藏' : '显示'}
        </button>
        <button
          onClick={() => setPass(newPassphrase())}
          className="kd-btn kd-btn-ghost !px-2.5 !py-1 text-[12px]"
        >
          随机生成
        </button>
        <button
          onClick={() => void save()}
          disabled={!dirty || st.running}
          className="kd-btn kd-btn-primary !px-2.5 !py-1 text-[12px]"
        >
          {saved && dirty ? '迁移到新口令' : '保存并同步'}
        </button>
        {!pass.trim() && saved && <span className="text-[11px] text-ink-3">清空口令并保存 = 关闭同步（云上那份不动）</span>}
        <label className="flex shrink-0 items-center gap-1.5 text-ink-3">
          <input
            type="checkbox"
            checked={deleteOld}
            onChange={(e) => setDeleteOld(e.target.checked)}
            className="h-3.5 w-3.5 accent-[var(--color-food)]"
          />
          删旧空间
        </label>
      </div>

      {err && <p className="mt-2 text-danger">{err}</p>}

      <p className="mt-2 leading-relaxed text-ink-3">
        口令决定数据存在云上哪个空间（线上只传它的哈希，不传原文）。换设备时填同一个口令就拉到同一份数据；
        改口令会把旧空间的数据合并到本地再推到新空间，勾选「删旧空间」同时清掉旧快照。
        本地 IndexedDB 始终是主存储，同步失败也不影响浏览；清空口令并保存就退回纯本地模式。
      </p>
      <p className="mt-1 flex items-start gap-1.5 leading-relaxed text-ink-3">
        <Icon name="alert" className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        数据在公网上是按口令分开的明文快照，只放你自己的探店记录，别往里塞敏感信息。
      </p>
    </div>
  );
}
