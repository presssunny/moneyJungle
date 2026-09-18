import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
 testDir:'./tests/e2e',fullyParallel:false,workers:1,timeout:30000,
 use:{baseURL:'http://127.0.0.1:5174',trace:'retain-on-failure'},
 projects:[{name:'desktop',use:{...devices['Desktop Chrome']}},{name:'mobile',use:{...devices['Pixel 7']}}],
 webServer:{command:'node node_modules/vite/bin/vite.js --host 127.0.0.1 --port 5174 --strictPort',url:'http://127.0.0.1:5174',reuseExistingServer:false},
});
