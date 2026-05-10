import { CONFIG } from '../config.js';
import { state } from '../state.js';
import { updatePointCashChargeButtonAvailability } from './pointCashCharge.js';

export function updateProgress(task, current, total) {
    if (task) {
        const element = document.getElementById(`stove-${task}`);
        if (element) element.textContent = `${current}/${total}`;
    }

    const questTotalTasks = CONFIG.targets.articleLikes + CONFIG.targets.comments + CONFIG.targets.newArticle;
    const questCompletedTasks = state.progress.articleLikes + state.progress.comments + state.progress.newArticle;

    const additionalCompletedTasks =
        (state.completed.roulette ? 1 : 0) +
        (state.completed.dailyShop ? 1 : 0) +
        (state.completed.majak ? 1 : 0);

    const totalTasks = questTotalTasks + 3;
    const completedTasks = questCompletedTasks + additionalCompletedTasks;
    const percentage = Math.round((completedTasks / totalTasks) * 100);

    const progressFill = document.querySelector('.stove-progress-fill');
    if (progressFill) progressFill.style.width = `${percentage}%`;

    const progressText = document.getElementById('stove-progress-text');
    if (progressText) {
        if (percentage < 10) {
            progressText.style.opacity = '0';
            progressText.textContent = '';
        } else {
            progressText.style.opacity = '1';
            progressText.textContent = `${percentage}%`;
        }
    }
}

export function setButtonState(running) {
    const btnIds = ['stove-btn-start', 'stove-btn-reward-shop', 'stove-btn-status-refresh', 'stove-btn-test-tab'];

    for (const id of btnIds) {
        const btn = document.getElementById(id);
        if (btn) {
            btn.disabled = running;
            btn.style.opacity = running ? '0.5' : '1';
        }
    }

    updatePointCashChargeButtonAvailability(state.pointCashCharge.availableFlake, { running });
}

export function extractComments(articles, count) {
    const comments = [];
    for (const article of articles) {
        if (article.comments) {
            for (const comment of article.comments) {
                if (comment.comment_id) {
                    comments.push(comment.comment_id);
                    if (comments.length >= count) return comments;
                }
            }
        }
    }
    return comments;
}
