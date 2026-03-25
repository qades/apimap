export async function handle({ event, resolve }) {
	const response = await resolve(event);
	
	// Inject API config into the HTML if it's a text/html response
	if (response.headers.get('content-type')?.includes('text/html')) {
		const port = parseInt(process.env.VITE_API_PORT || '3000', 10);
		const externalPort = parseInt(process.env.VITE_API_EXTERNAL_PORT || String(port), 10);
		const host = process.env.VITE_API_HOST || 'localhost';
		
		// Build the API config object
		const apiConfig = {
			port,
			externalPort,
			host,
			url: `http://${host}:${externalPort}`
		};
		
		const originalText = await response.text();
		// Replace the entire API_CONFIG assignment, handling both placeholder format
		// and pre-rendered values from the build process
		const modifiedText = originalText.replace(
			/window\.API_CONFIG\s*=\s*["']?\{\{API_CONFIG\}\}["']?|window\.API_CONFIG\s*=\s*\{[^}]+\}/,
			`window.API_CONFIG = ${JSON.stringify(apiConfig)}`
		);
		
		return new Response(modifiedText, {
			status: response.status,
			statusText: response.statusText,
			headers: response.headers,
		});
	}
	
	return response;
}
