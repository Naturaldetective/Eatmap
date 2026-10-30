import { NavLink, Route, Routes } from 'react-router-dom';
import { useEffect } from 'react';
import MapPage from './pages/MapPage';
import JournalPage from './pages/JournalPage';
import ImportPage from './pages/ImportPage';
import RankingPage from './pages/RankingPage';
import DataPage from './pages/DataPage';
import Wordmark from './ui/Wordmark';
import Icon from './ui/Icon';
import { startAutoSync } from './sync/cloud';
import type { IconName } from './ui/Icon';

const NAV_ITEMS: { to: string; label: string; icon: IconName }[] = [
  { to: '/', label: '地图', icon: 'map' },
  { to: '/journal', label: '旅记', icon: 'flag' },
  { to: '/import', label: '导入', icon: 'inbox' },
  { to: '/ranking', label: '推荐', icon: 'ranking' },
  { to: '/data', label: '数据', icon: 'data' },
];

export default function App() {
  // 云端同步（§4.6）：进页面拉平、切后台前推平；没设口令时什么都不做
  useEffect(() => startAutoSync(), []);

  return (
    <div className="flex h-full flex-col bg-canvas">
      <header className="flex h-14 shrink-0 items-center gap-5 border-b border-line bg-surface px-5">
        <span className="flex shrink-0 items-center gap-2.5">
          <img src="/favicon.svg" alt="EatMap" className="h-7 w-7" />
          <Wordmark />
        </span>
        {/* 分段导航：轨道内浮起白块表示选中，不用渐变胶囊 */}
        <nav className="flex shrink-0 items-center gap-1 rounded-xl bg-surface-2 p-1">
          {NAV_ITEMS.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/'}
              className={({ isActive }) =>
                `flex items-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-1.5 text-[13px] transition-colors ${
                  isActive
                    ? 'bg-surface font-semibold text-ink shadow-[0_1px_2px_rgba(38,33,29,0.1)]'
                    : 'font-medium text-ink-3 hover:text-ink-2'
                }`
              }
            >
              <Icon name={item.icon} className="h-4 w-4" />
              {item.label}
            </NavLink>
          ))}
        </nav>
      </header>
      <main className="min-h-0 flex-1">
        <Routes>
          <Route path="/" element={<MapPage />} />
          <Route path="/journal" element={<JournalPage />} />
          <Route path="/import" element={<ImportPage />} />
          <Route path="/ranking" element={<RankingPage />} />
          <Route path="/data" element={<DataPage />} />
        </Routes>
      </main>
    </div>
  );
}
