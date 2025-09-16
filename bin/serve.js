#!/usr/bin/env node

const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');

const PORT = process.env.PORT || 9090;
const isDev = process.argv.includes('--dev');

// MIME types mapping
const mimeTypes = {
	'.html': 'text/html',
	'.js': 'application/javascript',
	'.css': 'text/css',
	'.json': 'application/json',
	'.png': 'image/png',
	'.jpg': 'image/jpeg',
	'.gif': 'image/gif',
	'.svg': 'image/svg+xml',
	'.wav': 'audio/wav',
	'.mp3': 'audio/mpeg',
	'.mp4': 'video/mp4',
	'.woff': 'application/font-woff',
	'.ttf': 'application/font-ttf',
	'.eot': 'application/vnd.ms-fontobject',
	'.otf': 'application/font-otf',
	'.wasm': 'application/wasm'
};

function getContentType(filePath) {
	const ext = path.extname(filePath).toLowerCase();
	return mimeTypes[ext] || 'application/octet-stream';
}

function serveFile(res, filePath) {
	fs.readFile(filePath, (err, content) => {
		if (err) {
			if (err.code === 'ENOENT') {
				res.writeHead(404, { 'Content-Type': 'text/html' });
				res.end('<h1>404 Not Found</h1>', 'utf-8');
			} else {
				res.writeHead(500);
				res.end(`Server Error: ${err.code}`, 'utf-8');
			}
		} else {
			const contentType = getContentType(filePath);
			res.writeHead(200, {
				'Content-Type': contentType,
				'Access-Control-Allow-Origin': '*',
				'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
				'Access-Control-Allow-Headers': 'Content-Type, Authorization'
			});
			res.end(content, 'utf-8');
		}
	});
}

function serveDirectory(res, dirPath) {
	fs.readdir(dirPath, { withFileTypes: true }, (err, files) => {
		if (err) {
			res.writeHead(500);
			res.end(`Server Error: ${err.code}`, 'utf-8');
			return;
		}

		const fileList = files.map(file => {
			const isDir = file.isDirectory();
			const icon = isDir ? '📁' : '📄';
			const name = file.name;
			const href = isDir ? `${name}/` : name;
			return `<li><a href="${href}">${icon} ${name}</a></li>`;
		}).join('');

		const html = `
<!DOCTYPE html>
<html>
<head>
    <title>Directory listing</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 40px; }
        ul { list-style: none; padding: 0; }
        li { margin: 10px 0; }
        a { text-decoration: none; color: #007cba; }
        a:hover { text-decoration: underline; }
        .header { border-bottom: 1px solid #ddd; padding-bottom: 20px; margin-bottom: 20px; }
    </style>
</head>
<body>
    <div class="header">
        <h1>Directory listing for ${dirPath}</h1>
        <p>audio.libx.js development server</p>
    </div>
    <ul>
        <li><a href="../">📁 ..</a></li>
        ${fileList}
    </ul>
</body>
</html>`;

		res.writeHead(200, { 'Content-Type': 'text/html' });
		res.end(html, 'utf-8');
	});
}

const server = http.createServer((req, res) => {
	const parsedUrl = url.parse(req.url);
	let pathname = parsedUrl.pathname;

	// Security: prevent directory traversal
	if (pathname.includes('..')) {
		res.writeHead(400);
		res.end('Bad Request', 'utf-8');
		return;
	}

	// Handle root path
	if (pathname === '/') {
		pathname = '/examples/basic-usage.html';
	}

	// Handle files in examples directory - if path starts with /files/, prepend /examples
	if (pathname.startsWith('/files/')) {
		pathname = '/examples' + pathname;
	}

	const filePath = path.join(__dirname, '..', pathname);

	console.log(`${req.method} ${pathname} -> ${filePath}`);

	fs.stat(filePath, (err, stats) => {
		if (err) {
			res.writeHead(404, { 'Content-Type': 'text/html' });
			res.end('<h1>404 Not Found</h1>', 'utf-8');
			return;
		}

		if (stats.isFile()) {
			serveFile(res, filePath);
		} else if (stats.isDirectory()) {
			// Check for index.html in directory
			const indexPath = path.join(filePath, 'index.html');
			fs.stat(indexPath, (err, indexStats) => {
				if (!err && indexStats.isFile()) {
					serveFile(res, indexPath);
				} else {
					serveDirectory(res, filePath);
				}
			});
		}
	});
});

server.listen(PORT, () => {
	console.log(`🎵 audio.libx.js development server running at:`);
	console.log(`   http://localhost:${PORT}`);
	console.log(`   http://127.0.0.1:${PORT}`);
	console.log('');
	console.log('📁 Available examples:');
	console.log(`   http://localhost:${PORT}/examples/basic-usage.html`);
	console.log('');
	if (isDev) {
		console.log('🔧 Development mode enabled');
	}
	console.log('Press Ctrl+C to stop the server');
});

// Graceful shutdown
process.on('SIGINT', () => {
	console.log('\n👋 Shutting down server...');
	server.close(() => {
		console.log('Server stopped.');
		process.exit(0);
	});
});

process.on('SIGTERM', () => {
	console.log('\n👋 Shutting down server...');
	server.close(() => {
		console.log('Server stopped.');
		process.exit(0);
	});
});
