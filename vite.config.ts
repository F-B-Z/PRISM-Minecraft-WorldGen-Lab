import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import VueI18nPlugin from "@intlify/unplugin-vue-i18n/vite";
import path from 'path'

// https://vitejs.dev/config/
export default defineConfig({
  define: {
    __PRISM_PUBLIC_BUILD__: JSON.stringify(process.env.VITE_PRISM_PUBLIC_BUILD === 'true')
  },
  plugins: [
    vue(),
    VueI18nPlugin({
      include: [path.resolve(__dirname, './locales/**')]
    })
  ],
  build: {
    sourcemap: true
  }
})
