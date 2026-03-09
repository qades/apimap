import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
	plugins: [sveltekit()],
	server: {
		port: 3001,
		allowedHosts: true,
		proxy: {
			'/api/admin': {
				target: 'http://localhost:3000',
				changeOrigin: true
			}
		}
	},
	css: {
		devSourcemap: true
	}
});
