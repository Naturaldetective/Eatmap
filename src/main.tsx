import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { seedCities } from './db/schema';
import './index.css';
// Leaflet 核心样式必须先于自定义样式引入
import 'leaflet/dist/leaflet.css';

// M1：启动时把内置 cities.json 灌入 IndexedDB（幂等 put，静态数据量小）
seedCities().catch((err) => {
  console.error('城市种子数据灌入失败，类目/坐标相关功能将不可用', err);
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
);
