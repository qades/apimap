export async function handle({ event, resolve }) {
	const response = await resolve(event);
	
	// Inject API config into the HTML if it's a text/html response
	if (response.headers.get('content-type')?.includes('text/html')) {
		const port = parseInt(process.env.VITE_API_PORT || '3000', 10);
		const externalPort = parseInt(process.env.VITE_API_EXTERNAL_PORT || String(port), 10);
		
		// In dev mode, inject a script that reads host from browser's location
		// This ensures it works regardless of how the user accesses the GUI
		const apiConfigScript = `
<script>
(function() {
	var host = window.location.hostname;
	var protocol = window.location.protocol === 'https:' ? 'https' : 'http';
	window.API_CONFIG = {
		port: ${port},
		externalPort: ${externalPort},
		host: host,
		url: protocol + '://' + host + ':' + ${externalPort}
	};
})();
</script>`;
		
		const originalText = await response.text();
		
		// Replace the API_CONFIG placeholder with the dynamic script
		// or insert it before the closing </head> tag
		let modifiedText;
		if (originalText.includes('window.API_CONFIG')) {
			// Replace existing API_CONFIG assignment
			modifiedText = originalText.replace(
				/window\.API_CONFIG\s*=\s*["']?\{\{API_CONFIG\}\}["']?|window\.API_CONFIG\s*=\s*\{[^}]+\};/,
				apiConfigScript
			);
		} else {
			// Insert before </head>
			modifiedText = originalText.replace('</head>', apiConfigScript + '</head>');
		}
		
		return new Response(modifiedText, {
			status: response.status,
			statusText: response.statusText,
			headers: response.headers,
		});
	}
	
	return response;
}
