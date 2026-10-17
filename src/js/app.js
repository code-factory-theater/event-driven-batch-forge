// Application State
        const appState = {
            queueDepth: 0,
            runningTasks: 0,
            backlogHistory: [],
            events: [],
            config: {
                minCapacity: 0,
                maxCapacity: 10,
                scaleOutCooldown: 60,
                scaleInCooldown: 300,
                targetBacklog: 100,
                scaleOutThreshold: 150,
                scaleInThreshold: 30
            },
            settings: {
                awsRegion: 'ap-northeast-1',
                sqsQueueName: 'batch-processing-queue',
                ecsClusterName: 'fargate-batch-cluster',
                ecsServiceName: 'batch-processor-service',
                refreshInterval: 10,
                enableNotifications: true
            },
            lastScaleAction: null,
            lastScaleTime: 0
        };

        // Initialize
        function init() {
            loadConfiguration();
            loadSettings();
            initializeChart();
            generateMockData();
            updateAllMetrics();
            
            // Auto-refresh
            setInterval(() => {
                generateMockData();
                updateAllMetrics();
            }, appState.settings.refreshInterval * 1000);
        }

        // Load configuration from localStorage
        function loadConfiguration() {
            const saved = localStorage.getItem('scalingConfig');
            if (saved) {
                appState.config = JSON.parse(saved);
            }
            updateConfigUI();
        }

        // Load settings from localStorage
        function loadSettings() {
            const saved = localStorage.getItem('scalingSettings');
            if (saved) {
                appState.settings = JSON.parse(saved);
            }
            updateSettingsUI();
        }

        // Save configuration
        function saveConfig() {
            appState.config = {
                minCapacity: parseInt(document.getElementById('minCapacity').value),
                maxCapacity: parseInt(document.getElementById('maxCapacity').value),
                scaleOutCooldown: parseInt(document.getElementById('scaleOutCooldown').value),
                scaleInCooldown: parseInt(document.getElementById('scaleInCooldown').value),
                targetBacklog: parseInt(document.getElementById('targetBacklog').value),
                scaleOutThreshold: parseInt(document.getElementById('scaleOutThreshold').value),
                scaleInThreshold: parseInt(document.getElementById('scaleInThreshold').value)
            };
            localStorage.setItem('scalingConfig', JSON.stringify(appState.config));
            updateSummary();
            showNotification('Configuration saved successfully!', 'success');
        }

        // Reset configuration to defaults
        function resetConfig() {
            if (confirm('Reset configuration to defaults?')) {
                localStorage.removeItem('scalingConfig');
                appState.config = {
                    minCapacity: 0,
                    maxCapacity: 10,
                    scaleOutCooldown: 60,
                    scaleInCooldown: 300,
                    targetBacklog: 100,
                    scaleOutThreshold: 150,
                    scaleInThreshold: 30
                };
                updateConfigUI();
                updateSummary();
                showNotification('Configuration reset to defaults!', 'info');
            }
        }

        // Update configuration UI
        function updateConfigUI() {
            document.getElementById('minCapacity').value = appState.config.minCapacity;
            document.getElementById('maxCapacity').value = appState.config.maxCapacity;
            document.getElementById('scaleOutCooldown').value = appState.config.scaleOutCooldown;
            document.getElementById('scaleInCooldown').value = appState.config.scaleInCooldown;
            document.getElementById('targetBacklog').value = appState.config.targetBacklog;
            document.getElementById('scaleOutThreshold').value = appState.config.scaleOutThreshold;
            document.getElementById('scaleInThreshold').value = appState.config.scaleInThreshold;
            document.getElementById('scaleOutDisplay').textContent = appState.config.scaleOutThreshold + '%';
            document.getElementById('scaleInDisplay').textContent = appState.config.scaleInThreshold + '%';
        }

        // Update settings UI
        function updateSettingsUI() {
            document.getElementById('awsRegion').value = appState.settings.awsRegion;
            document.getElementById('sqsQueueName').value = appState.settings.sqsQueueName;
            document.getElementById('ecsClusterName').value = appState.settings.ecsClusterName;
            document.getElementById('ecsServiceName').value = appState.settings.ecsServiceName;
            document.getElementById('refreshInterval').value = appState.settings.refreshInterval;
            document.getElementById('enableNotifications').checked = appState.settings.enableNotifications;
        }

        // Save advanced settings
        function saveAdvancedSettings() {
            appState.settings = {
                awsRegion: document.getElementById('awsRegion').value,
                sqsQueueName: document.getElementById('sqsQueueName').value,
                ecsClusterName: document.getElementById('ecsClusterName').value,
                ecsServiceName: document.getElementById('ecsServiceName').value,
                refreshInterval: parseInt(document.getElementById('refreshInterval').value),
                enableNotifications: document.getElementById('enableNotifications').checked
            };
            localStorage.setItem('scalingSettings', JSON.stringify(appState.settings));
            closeSettings();
            showNotification('Settings saved! Refresh interval updated.', 'success');
        }

        // Modal handlers
        function openSettings() {
            updateSettingsUI();
            document.getElementById('settingsModal').classList.add('active');
        }

        function closeSettings() {
            document.getElementById('settingsModal').classList.remove('active');
        }

        // Generate mock data
        function generateMockData() {
            // Simulate realistic queue depth and task patterns
            const time = new Date().getTime();
            const hour = new Date().getHours();
            
            // Business hours have more traffic
            const trafficMultiplier = (hour >= 9 && hour <= 18) ? 1.5 : 0.3;
            
            // Random spike
            const spike = Math.random() > 0.95 ? Math.random() * 2000 : 0;
            
            appState.queueDepth = Math.max(0, Math.floor(
                (100 + Math.sin(time / 30000) * 300 + Math.random() * 200) * trafficMultiplier + spike
            ));
            
            // Calculate optimal task count based on backlog per task
            const backlogPerTask = appState.runningTasks === 0 
                ? appState.queueDepth 
                : appState.queueDepth / appState.runningTasks;
            
            // Apply scaling logic
            const now = Date.now();
            const cooldownElapsed = (now - appState.lastScaleTime) > 
                ((appState.runningTasks < Math.ceil(backlogPerTask / appState.config.targetBacklog)) 
                    ? appState.config.scaleOutCooldown * 1000 
                    : appState.config.scaleInCooldown * 1000);
            
            if (cooldownElapsed && appState.queueDepth > 0) {
                const targetBacklogThreshold = appState.config.targetBacklog;
                const scaleOutThreshold = (targetBacklogThreshold * appState.config.scaleOutThreshold) / 100;
                const scaleInThreshold = (targetBacklogThreshold * appState.config.scaleInThreshold) / 100;
                
                if (backlogPerTask > scaleOutThreshold && appState.runningTasks < appState.config.maxCapacity) {
                    appState.runningTasks = Math.min(
                        appState.config.maxCapacity,
                        appState.runningTasks + 1
                    );
                    addEvent('SCALE_OUT', `Scaled out to ${appState.runningTasks} tasks (BacklogPerTask: ${backlogPerTask.toFixed(1)})`);
                    appState.lastScaleAction = 'SCALE_OUT';
                    appState.lastScaleTime = now;
                } else if (backlogPerTask < scaleInThreshold && appState.runningTasks > appState.config.minCapacity) {
                    appState.runningTasks = Math.max(
                        appState.config.minCapacity,
                        appState.runningTasks - 1
                    );
                    addEvent('SCALE_IN', `Scaled in to ${appState.runningTasks} tasks (BacklogPerTask: ${backlogPerTask.toFixed(1)})`);
                    appState.lastScaleAction = 'SCALE_IN';
                    appState.lastScaleTime = now;
                }
            } else if (appState.queueDepth === 0 && appState.runningTasks > 0) {
                // Queue is empty, graceful shutdown
                appState.runningTasks = 0;
                addEvent('GRACEFUL_SHUTDOWN', 'Queue empty, all tasks gracefully terminated');
                appState.lastScaleAction = 'GRACEFUL_SHUTDOWN';
            }
            
            // Track backlog history
            const backlogPerTask = appState.runningTasks === 0 
                ? appState.queueDepth 
                : appState.queueDepth / appState.runningTasks;
            
            appState.backlogHistory.push({
                time: new Date(),
                backlog: backlogPerTask
            });
            
            // Keep only last 60 data points
            if (appState.backlogHistory.length > 60) {
                appState.backlogHistory.shift();
            }
        }

        // Add event to history
        function addEvent(type, message) {
            appState.events.unshift({
                type: type,
                message: message,
                timestamp: new Date(),
                id: Date.now()
            });
            
            // Keep only last 50 events
            if (appState.events.length > 50) {
                appState.events.pop();
            }
            
            updateEventLog();
            
            // Notification
            if (appState.settings.enableNotifications) {
                showNotification(message, type === 'SCALE_OUT' ? 'warning' : type === 'SCALE_IN' ? 'info' : 'success');
            }
        }

        // Update all metrics
        function updateAllMetrics() {
            // Queue depth
            const prevQueueDepth = parseInt(document.getElementById('queueDepth').textContent) || 0;
            const queueChange = appState.queueDepth - prevQueueDepth;
            const queueChangePercent = prevQueueDepth === 0 ? 0 : ((queueChange / prevQueueDepth) * 100).toFixed(0);
            
            document.getElementById('queueDepth').textContent = appState.queueDepth;
            const changeEl = document.getElementById('queueDepthChange');
            changeEl.textContent = `${queueChange >= 0 ? '+' : ''}${queueChange} (${queueChangePercent}%)`;
            changeEl.className = 'metric-change ' + (queueChange >= 0 ? 'positive' : 'negative');
            
            // Running tasks
            document.getElementById('runningTasks').textContent = appState.runningTasks;
            document.getElementById('runningTasksChange').textContent = `${appState.runningTasks} task${appState.runningTasks !== 1 ? 's' : ''} running`;
            
            // Backlog per task
            const backlogPerTask = appState.runningTasks === 0 
                ? (appState.queueDepth > 0 ? appState.queueDepth : 0)
                : appState.queueDepth / appState.runningTasks;
            
            document.getElementById('backlogPerTask').textContent = backlogPerTask.toFixed(1);
            
            // Backlog progress
            const targetBacklog = appState.config.targetBacklog;
            const scaleOutThreshold = (targetBacklog * appState.config.scaleOutThreshold) / 100;
            const progressPercent = Math.min(100, (backlogPerTask / scaleOutThreshold) * 100);
            document.getElementById('backlogProgress').style.width = progressPercent + '%';
            document.getElementById('backlogProgress').textContent = Math.round(progressPercent) + '%';
            
            // Scaling status
            let scalingStatus = 'Monitoring';
            let nextAction = 'Waiting for threshold';
            
            if (appState.runningTasks === 0) {
                scalingStatus = 'Idle';
                nextAction = 'Awaiting queue activity';
            } else if (backlogPerTask > scaleOutThreshold) {
                scalingStatus = '📈 Scaling Up';
                nextAction = `BacklogPerTask (${backlogPerTask.toFixed(1)}) > Threshold (${scaleOutThreshold.toFixed(1)})`;
            } else if (backlogPerTask < (targetBacklog * appState.config.scaleInThreshold) / 100) {
                scalingStatus = '📉 Scaling Down';
                nextAction = `BacklogPerTask (${backlogPerTask.toFixed(1)}) < Threshold (${((targetBacklog * appState.config.scaleInThreshold) / 100).toFixed(1)})`;
            } else {
                scalingStatus = '✅ Optimal';
                nextAction = 'Load balanced across tasks';
            }
            
            document.getElementById('scalingStatus').textContent = scalingStatus;
            document.getElementById('nextAction').textContent = nextAction;
            
            // Status indicator
            const statusDot = document.getElementById('statusDot');
            const statusText = document.getElementById('statusText');
            
            if (backlogPerTask > scaleOutThreshold * 1.2) {
                statusDot.className = 'status-dot critical';
                statusText.textContent = 'Critical';
            } else if (backlogPerTask > scaleOutThreshold) {
                statusDot.className = 'status-dot warning';
                statusText.textContent = 'Warning';
            } else {
                statusDot.className = 'status-dot healthy';
                statusText.textContent = 'Healthy';
            }
            
            // Update chart
            updateChart();
            
            // Update summary
            updateSummary();
        }

        // Chart management
        let backlogChart;

        function initializeChart() {
            const ctx = document.getElementById('backlogChart').getContext('2d');
            backlogChart = new ChartSimple(ctx, 'line');
        }

        function updateChart() {
            const labels = appState.backlogHistory.map((_, i) => {
                const idx = i - appState.backlogHistory.length + 1;
                return idx % 10 === 0 ? Math.abs(idx) + ' min ago' : '';
            });
            
            const data = appState.backlogHistory.map(h => h.backlog);
            
            const targetBacklog = appState.config.targetBacklog;
            const scaleOutThreshold = (targetBacklog * appState.config.scaleOutThreshold) / 100;
            
            // Simple chart update
            const canvas = document.getElementById('backlogChart');
            const ctx = canvas.getContext('2d');
            
            // Clear
            ctx.fillStyle = '#fff';
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            
            // Draw grid
            ctx.strokeStyle = '#e0e0e0';
            ctx.lineWidth = 1;
            for (let i = 0; i <= 5; i++) {
                const y = (canvas.height / 5) * i;
                ctx.beginPath();
                ctx.moveTo(0, y);
                ctx.lineTo(canvas.width, y);
                ctx.stroke();
            }
            
            // Draw threshold line
            if (scaleOutThreshold > 0) {
                const maxValue = Math.max(...data, scaleOutThreshold * 1.2);
                const thresholdY = canvas.height - (scaleOutThreshold / maxValue) * canvas.height;
                ctx.strokeStyle = '#dc3545';
                ctx.lineWidth = 2;
                ctx.setLineDash([5, 5]);
                ctx.beginPath();
                ctx.moveTo(0, thresholdY);
                ctx.lineTo(canvas.width, thresholdY);
                ctx.stroke();
                ctx.setLineDash([]);
                
                // Label
                ctx.fillStyle = '#dc3545';
                ctx.font = 'bold 12px Arial';
                ctx.fillText('Scale-Out Threshold: ' + scaleOutThreshold.toFixed(0), 10, thresholdY - 8);
            }
            
            // Draw line
            if (data.length > 0) {
                const maxValue = Math.max(...data, scaleOutThreshold * 1.2);
                ctx.strokeStyle = '#667eea';
                ctx.lineWidth = 3;
                ctx.beginPath();
                
                data.forEach((value, i) => {
                    const x = (canvas.width / (data.length - 1 || 1)) * i;
                    const y = canvas.height - (value / maxValue) * canvas.height;
                    if (i === 0) {
                        ctx.moveTo(x, y);
                    } else {
                        ctx.lineTo(x, y);
                    }
                });
                
                ctx.stroke();
                
                // Draw points
                ctx.fillStyle = '#667eea';
                data.forEach((value, i) => {
                    const x = (canvas.width / (data.length - 1 || 1)) * i;
                    const y = canvas.height - (value / maxValue) * canvas.height;
                    ctx.beginPath();
                    ctx.arc(x, y, 4, 0, Math.PI * 2);
                    ctx.fill();
                });
            }
        }

        // Simple chart fallback
        class ChartSimple {
            constructor(ctx, type) {
                this.ctx = ctx;
                this.type = type;
            }
        }

        // Tab switching
        function switchTab(tabName) {
            // Hide all tabs
            document.querySelectorAll('.tab-content').forEach(el => {
                el.classList.remove('active');
            });
            document.querySelectorAll('.tab').forEach(el => {
                el.classList.remove('active');
            });
            
            // Show selected tab
            document.getElementById(tabName).classList.add('active');
            event.target.classList.add('active');
        }

        // Update event log
        function updateEventLog() {
            const eventLog = document.getElementById('eventLog');
            
            if (appState.events.length === 0) {
                eventLog.innerHTML = '<div style="color: #999; text-align: center; padding: 30px;">No events yet. Scaling events will appear here.</div>';
                return;
            }
            
            eventLog.innerHTML = appState.events.map(event => `
                <div class="event-item ${event.type === 'SCALE_OUT' ? 'scale-out' : event.type === 'SCALE_IN' ? 'scale-in' : ''}">
                    <div class="event-time">${event.timestamp.toLocaleTimeString()}</div>
                    <div class="event-message">${getEventIcon(event.type)} ${event.type}</div>
                    <div class="event-detail">${event.message}</div>
                </div>
            `).join('');
        }

        function getEventIcon(type) {
            switch(type) {
                case 'SCALE_OUT': return '📈';
                case 'SCALE_IN': return '📉';
                case 'GRACEFUL_SHUTDOWN': return '🛑';
                default: return '📋';
            }
        }

        // Simulator
        function runSimulation() {
            const queueDepth = parseInt(document.getElementById('simQueueDepth').value) || 0;
            const tasks = parseInt(document.getElementById('simTasks').value) || 1;
            
            const backlogPerTask = tasks === 0 ? queueDepth : queueDepth / tasks;
            
            const targetBacklog = appState.config.targetBacklog;
            const scaleOutThreshold = (targetBacklog * appState.config.scaleOutThreshold) / 100;
            const scaleInThreshold = (targetBacklog * appState.config.scaleInThreshold) / 100;
            
            let action = '✅ No action - Load is balanced';
            let nextTasks = tasks;
            
            if (backlogPerTask > scaleOutThreshold) {
                action = '📈 SCALE OUT recommended';
                nextTasks = Math.min(appState.config.maxCapacity, tasks + 1);
            } else if (backlogPerTask < scaleInThreshold && tasks > appState.config.minCapacity) {
                action = '📉 SCALE IN recommended';
                nextTasks = Math.max(appState.config.minCapacity, tasks - 1);
            }
            
            document.getElementById('simBacklog').textContent = backlogPerTask.toFixed(2);
            document.getElementById('simAction').innerHTML = action;
            document.getElementById('simTargetTasks').textContent = nextTasks;
            
            document.getElementById('simResult').style.display = 'block';
        }

        // Update threshold display
        function updateThresholdDisplay(inputId, displayId) {
            document.getElementById(displayId).textContent = document.getElementById(inputId).value + '%';
        }

        // Update summary
        function updateSummary() {
            document.getElementById('summaryMinCapacity').textContent = appState.config.minCapacity;
            document.getElementById('summaryMaxCapacity').textContent = appState.config.maxCapacity;
            document.getElementById('summaryTargetBacklog').textContent = appState.config.targetBacklog;
            document.getElementById('summaryScaleOutCooldown').textContent = appState.config.scaleOutCooldown + 's';
            document.getElementById('summaryScaleInCooldown').textContent = appState.config.scaleInCooldown + 's';
        }

        // Refresh metrics
        function refreshMetrics() {
            generateMockData();
            updateAllMetrics();
            showNotification('Metrics refreshed', 'success');
        }

        // Export data
        function exportData() {
            const exportData = {
                timestamp: new Date().toISOString(),
                currentMetrics: {
                    queueDepth: appState.queueDepth,
                    runningTasks: appState.runningTasks,
                    backlogPerTask: appState.runningTasks === 0 ? appState.queueDepth : appState.queueDepth / appState.runningTasks
                },
                configuration: appState.config,
                events: appState.events
            };
            
            const json = JSON.stringify(exportData, null, 2);
            const blob = new Blob([json], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `scaling-metrics-${Date.now()}.json`;
            a.click();
            URL.revokeObjectURL(url);
            
            showNotification('Data exported successfully', 'success');
        }

        // Notification
        function showNotification(message, type = 'info') {
            // Simple notification using browser alert (in production, use toast library)
            console.log(`[${type.toUpperCase()}] ${message}`);
        }

        // Start application
        init();