export function logEvent(logElementId, message, data = null) {
	const timestamp = new Date().toLocaleTimeString();
	const logElement = typeof logElementId === 'string' ? document.getElementById(logElementId) : logElementId;
	if (!logElement) return;
	
	const logEntry = document.createElement('div');
	logEntry.className = 'log-entry';
	
	let html = `<span class="log-timestamp">[${timestamp}]</span> <span class="log-message">${message}</span>`;
	if (data) {
		html += ` <span class="log-data">${JSON.stringify(data)}</span>`;
	}
	
	logEntry.innerHTML = html;
	logElement.appendChild(logEntry);
	logElement.scrollTop = logElement.height;
}

export function updateStatus(statusElementId, message, type = 'info') {
	const statusElement = typeof statusElementId === 'string' ? document.getElementById(statusElementId) : statusElementId;
	if (!statusElement) return;
	
	statusElement.textContent = message;
	statusElement.className = `status ${type === 'error' ? 'error' : type === 'success' ? 'success' : ''}`;
}

export function formatFileSize(bytes) {
	if (bytes < 1024) return bytes + ' B';
	if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
	return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

export function formatDuration(ms) {
	const seconds = Math.floor(ms / 1000);
	const minutes = Math.floor(seconds / 60);
	const remainingSeconds = seconds % 60;
	return `${minutes.toString().padStart(2, '0')}:${remainingSeconds.toString().padStart(2, '0')}`;
}

export function initializeRangeInputs() {
	const rangeInputs = document.querySelectorAll('input[type="range"]');
	rangeInputs.forEach((input) => {
		const valueElement = document.getElementById(input.id + 'Value');
		if (valueElement) {
			input.addEventListener('input', () => {
				valueElement.textContent = input.value;
			});
		}
	});
}

