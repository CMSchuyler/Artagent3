import react from "@vitejs/plugin-react";
import tailwind from "tailwindcss";
import { defineConfig } from "vite";

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  base: "./",
  css: {
    postcss: {
      plugins: [tailwind()],
    },
  },
  server: {
    proxy: {
      '/api/liblibai': {
        target: 'https://openapi.liblibai.cloud',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/liblibai/, ''),
        secure: false,
        headers: {
          'Referer': 'https://openapi.liblibai.cloud',
          'Origin': 'https://openapi.liblibai.cloud'
        }
      },
      '/oss-proxy': {
        target: 'https://liblibai-airship-temp.oss-cn-beijing.aliyuncs.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/oss-proxy/, ''),
        secure: false,
        headers: {
          'Referer': 'https://liblibai-airship-temp.oss-cn-beijing.aliyuncs.com',
          'Origin': 'https://liblibai-airship-temp.oss-cn-beijing.aliyuncs.com'
        }
      }
    }
  }
});
