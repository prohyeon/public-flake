import { defineConfig } from 'vite';
import monkey from 'vite-plugin-monkey';

export default defineConfig({
    build: {
        outDir: '.',
        emptyOutDir: false,
    },
    plugins: [
        monkey({
            entry: 'src/main.js',
            userscript: {
                name: 'STOVE Quest Automation',
                namespace: 'https://profile.onstove.com/',
                version: '2.11.1',
                description: 'STOVE 자동화 (게시글 추천, 댓글, 글쓰기, 부스트 1회, 게임 리뷰 이벤트 댓글, 룰렛, 데일리 보상)',
                author: 'prohyeon',
                match: ['https://profile.onstove.com/*'],
                grant: ['GM_xmlhttpRequest', 'GM_openInTab'],
                connect: ['api.onstove.com', 'reward.onstove.com'],
                updateURL: 'https://github.com/prohyeon/public-flake/raw/refs/heads/main/stove-quest-automation.user.js',
                downloadURL: 'https://github.com/prohyeon/public-flake/raw/refs/heads/main/stove-quest-automation.user.js',
                supportURL: 'https://github.com/prohyeon/public-flake/issues',
                'run-at': 'document-idle',
            },
            build: {
                fileName: 'stove-quest-automation.user.js',
            },
        }),
    ],
});
