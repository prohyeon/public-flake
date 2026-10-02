export function apiRequest(url, method, headers, body = null, options = {}) {
    return new Promise((resolve, reject) => {
        const requestConfig = {
            method,
            url,
            headers,
            anonymous: true,
            data: body ? JSON.stringify(body) : null,
            onload(response) {
                console.log(`[API Request] ${method} ${url} - Status: ${response.status}`);
                if (response.status >= 200 && response.status < 300) {
                    try {
                        const data = JSON.parse(response.responseText);
                        resolve(data);
                    } catch (e) {
                        console.warn('[API Request] Failed to parse JSON response:', e);
                        resolve({ success: true });
                    }
                } else {
                    console.error('[API Request] Error response:', response);
                    reject(new Error(`API Error: ${response.status} ${response.statusText}`));
                }
            },
            ontimeout() {
                reject(new Error('API request timed out'));
            },
            onabort() {
                reject(new Error('API request aborted'));
            },
            onerror(error) {
                console.error('[API Request] Network error:', error);
                reject(new Error('Network error'));
            }
        };

        // Tampermonkey's anonymous/fetch path aborts requests with a body when
        // timeout is explicitly 0. Omit it unless a positive timeout is requested.
        if (Number.isFinite(options.timeout) && options.timeout > 0) {
            requestConfig.timeout = options.timeout;
        }

        console.log('[API Request] Starting request:', { method, url, hasBody: !!body });
        GM_xmlhttpRequest(requestConfig);
    });
}
