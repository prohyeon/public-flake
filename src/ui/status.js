export function updateStatusUI(statusData) {
    const articleWriteEl = document.getElementById('stove-status-article');
    if (articleWriteEl && statusData.articleWrite) {
        if (statusData.articleWrite.loading) {
            articleWriteEl.innerHTML = '<span style="color: #3b82f6">⏳ 확인 중...</span>';
        } else if (statusData.articleWrite.success) {
            const { hasWrittenToday, todayCount } = statusData.articleWrite;
            if (hasWrittenToday) {
                articleWriteEl.innerHTML = `<span style="color: #10b981">✅ 오늘 ${todayCount}개 작성</span>`;
            } else {
                articleWriteEl.innerHTML = '<span style="color: #f59e0b">✍️ 아직 작성 안 함</span>';
            }
        } else {
            articleWriteEl.innerHTML = '<span style="color: #ef4444">❌ 확인 실패</span>';
        }
    }

    if (statusData.dailyMission) {
        if (statusData.dailyMission.loading) {
            ['daily', 'weekly', 'content', 'attendance'].forEach(cat => {
                const el = document.getElementById(`stove-status-mission-${cat}`);
                if (el) el.innerHTML = '<span style="color: #3b82f6">⏳</span>';
            });
        } else if (statusData.dailyMission.success && statusData.dailyMission.categories) {
            const categories = statusData.dailyMission.categories;

            ['daily', 'weekly', 'content', 'attendance'].forEach(catKey => {
                const el = document.getElementById(`stove-status-mission-${catKey}`);
                const cat = categories[catKey];

                if (el) {
                    if (!cat || cat.total === 0) {
                        el.innerHTML = '<span style="color: #6b7280">-</span>';
                        return;
                    }

                    const { completed, receivable, total, missions } = cat;
                    let statusHTML = '';

                    if (catKey === 'attendance') {
                        const attendanceMission = missions.find(m => m.milestone_per_cnt && m.user_complete_cnt !== undefined);
                        if (attendanceMission) {
                            statusHTML = `<span style="color: #6b7280">${attendanceMission.milestone_per_cnt}일중 ${attendanceMission.user_complete_cnt}일출석</span>`;
                        } else if (receivable > 0) {
                            statusHTML = `<span style="color: #f59e0b">🎁 ${receivable}개</span>`;
                        } else {
                            statusHTML = '<span style="color: #6b7280">-</span>';
                        }
                    } else {
                        if (completed === total) {
                            statusHTML = '<span style="color: #10b981">✅ 완료</span>';
                        } else if (receivable > 0) {
                            statusHTML = `<span style="color: #f59e0b">🎁 ${receivable}개</span>`;
                        } else if (completed === 0) {
                            statusHTML = '<span style="color: #6b7280">받을 보상 없음</span>';
                        } else {
                            statusHTML = `<span style="color: #6b7280">${completed}/${total}</span>`;
                        }
                    }

                    el.innerHTML = statusHTML;

                    const parentItem = el.closest('.stove-mission-item');
                    if (parentItem && missions && missions.length > 0) {
                        const existingTooltip = parentItem.querySelector('.stove-mission-tooltip');
                        if (existingTooltip) existingTooltip.remove();

                        const tooltip = document.createElement('div');
                        tooltip.className = 'stove-mission-tooltip';

                        const catLabel = catKey === 'daily' ? '📅 데일리 미션' :
                            catKey === 'weekly' ? '📆 위클리 미션' :
                                catKey === 'content' ? '💬 컨텐츠' : '📆 월간출석';

                        let tooltipHTML = `<div class="stove-mission-tooltip-title">${catLabel}</div>`;
                        missions.forEach(mission => {
                            const statusIcon = (mission.status === 'COMPLETE' || mission.status === 'COMPLETED') ? '✅' :
                                mission.status === 'RECEIVABLE' ? '🎁' : '⏳';
                            const statusColor = (mission.status === 'COMPLETE' || mission.status === 'COMPLETED') ? '#10b981' :
                                mission.status === 'RECEIVABLE' ? '#f59e0b' : '#6b7280';

                            tooltipHTML += `
                                <div class="stove-mission-tooltip-item">
                                    <span class="stove-mission-tooltip-name">${mission.title}</span>
                                    <span class="stove-mission-tooltip-status" style="color: ${statusColor}">${statusIcon}</span>
                                </div>
                            `;
                        });

                        tooltip.innerHTML = tooltipHTML;
                        parentItem.appendChild(tooltip);
                    }
                }
            });
        } else {
            ['daily', 'weekly', 'content', 'attendance'].forEach(cat => {
                const el = document.getElementById(`stove-status-mission-${cat}`);
                if (el) el.innerHTML = '<span style="color: #ef4444">❌</span>';
            });
        }
    }

    const rouletteEl = document.getElementById('stove-status-roulette');
    if (rouletteEl && statusData.roulette) {
        if (statusData.roulette.loading) {
            rouletteEl.innerHTML = '<span style="color: #3b82f6">⏳ 확인 중...</span>';
        } else if (statusData.roulette.success) {
            const { current, limit, remaining } = statusData.roulette;
            const color = remaining > 0 ? '#10b981' : '#6b7280';
            rouletteEl.innerHTML = `<span style="color: ${color}">${current}/${limit} (${remaining}회 남음)</span>`;
        } else {
            rouletteEl.innerHTML = '<span style="color: #ef4444">❌ 확인 실패</span>';
        }
    }

    const dailyShopEl = document.getElementById('stove-status-daily');
    if (dailyShopEl && statusData.dailyShop) {
        if (statusData.dailyShop.loading) {
            dailyShopEl.innerHTML = '<span style="color: #3b82f6">⏳ 확인 중...</span>';
        } else if (statusData.dailyShop.success) {
            const { received, notReceived, noRewardToday } = statusData.dailyShop;
            if (received) {
                dailyShopEl.innerHTML = '<span style="color: #10b981">✅ 전부 완료</span>';
            } else if (notReceived) {
                dailyShopEl.innerHTML = '<span style="color: #f59e0b">📦 보상 받지 않음</span>';
            } else if (noRewardToday) {
                dailyShopEl.innerHTML = '<span style="color: #9ca3af">⚠️ 오늘 보상 없음</span>';
            } else {
                dailyShopEl.innerHTML = '<span style="color: #6b7280">-</span>';
            }
        } else {
            dailyShopEl.innerHTML = '<span style="color: #ef4444">❌ 확인 실패</span>';
        }
    }

    const majakShopEl = document.getElementById('stove-status-majak');
    if (majakShopEl && statusData.majakShop) {
        if (statusData.majakShop.loading) {
            majakShopEl.innerHTML = '<span style="color: #3b82f6">⏳ 확인 중...</span>';
        } else if (statusData.majakShop.success) {
            const { received, notReceived, noRewardToday } = statusData.majakShop;
            if (received) {
                majakShopEl.innerHTML = '<span style="color: #10b981">✅ 전부 완료</span>';
            } else if (notReceived) {
                majakShopEl.innerHTML = '<span style="color: #f59e0b">🀄 보상 받지 않음</span>';
            } else if (noRewardToday) {
                majakShopEl.innerHTML = '<span style="color: #9ca3af">⚠️ 오늘 보상 없음</span>';
            } else {
                majakShopEl.innerHTML = '<span style="color: #6b7280">-</span>';
            }
        } else {
            majakShopEl.innerHTML = '<span style="color: #ef4444">❌ 확인 실패</span>';
        }
    }

    const surveyEl = document.getElementById('stove-status-survey');
    if (surveyEl && statusData.survey) {
        if (statusData.survey.loading) {
            surveyEl.innerHTML = '<span style="color: #3b82f6">⏳ 확인 중...</span>';
        } else if (statusData.survey.success) {
            const { notAvailable, noMissions, completed, receivable, total, allCompleted } = statusData.survey;
            if (notAvailable) {
                surveyEl.innerHTML = '<span style="color: #6b7280">비활성화</span>';
            } else if (noMissions) {
                surveyEl.innerHTML = '<span style="color: #6b7280">미션 없음</span>';
            } else if (allCompleted) {
                surveyEl.innerHTML = '<span style="color: #10b981">✅ 전부 완료</span>';
            } else if (receivable > 0) {
                surveyEl.innerHTML = `<span style="color: #f59e0b">📊 ${receivable}개 투표 가능</span>`;
            } else if (completed > 0) {
                surveyEl.innerHTML = `<span style="color: #6b7280">${completed}/${total}</span>`;
            } else {
                surveyEl.innerHTML = '<span style="color: #6b7280">-</span>';
            }
        } else {
            surveyEl.innerHTML = '<span style="color: #ef4444">❌ 확인 실패</span>';
        }
    }

    const totalFlakeEl = document.getElementById('stove-status-total-flake');
    if (totalFlakeEl && statusData.totalFlake !== undefined) {
        if (statusData.totalFlake?.loading) {
            totalFlakeEl.innerHTML = '<span style="color: #3b82f6">⏳ 확인 중...</span>';
        } else if (statusData.totalFlake?.error) {
            totalFlakeEl.innerHTML = '<span style="color: #ef4444">❌ 확인 실패</span>';
        } else {
            totalFlakeEl.innerHTML = `<span style="color: #10b981">${statusData.totalFlake.toLocaleString()} F</span>`;
        }
    }

    const monthlyFlakeEl = document.getElementById('stove-status-monthly-flake');
    if (monthlyFlakeEl && statusData.monthlyFlake !== undefined) {
        if (statusData.monthlyFlake?.loading) {
            monthlyFlakeEl.innerHTML = '<span style="color: #3b82f6">⏳ 확인 중...</span>';
        } else if (statusData.monthlyFlake?.error) {
            monthlyFlakeEl.innerHTML = '<span style="color: #ef4444">❌ 확인 실패</span>';
        } else {
            monthlyFlakeEl.innerHTML = `<span style="color: #10b981">+${statusData.monthlyFlake.toLocaleString()} F</span>`;
        }
    }
}
