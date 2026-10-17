// =====================================
        // グローバル状態
        // =====================================
        let simulationState = {
            sqsBacklog: 0,
            runningTasks: 0,
            totalProcessed: 0,
            totalScaled: 0,
            lastScaleTime: { out: 0, in: 0 },
            isRunning: false,
            simulationStart: Date.now(),
            metricsHistory: [],
            alerts: [],
            latencies: []
        };

        const MAX_HISTORY = 30;

        // =====================================
        // ユーティリティ関数
        // =====================================
        function getConfig() {
            return {
                targetBacklog: parseInt(document.getElementById('targetBacklog').value),
                minTasks: parseInt(document.getElementById('minTasks').value),
                maxTasks: parseInt(document.getElementById('maxTasks').value),
                scaleOutCooldown: parseInt(document.getElementById('scaleOutCooldown').value),
                scaleInCooldown: parseInt(document.getElementById('scaleInCooldown').value),
                processingTime: parseFloat(document.getElementById('processingTime').value)
            };
        }

        function updateLabels() {
            document.getElementById('targetLabel').textContent = document.getElementById('targetBacklog').value;
            document.getElementById('minLabel').textContent = document.getElementById('minTasks').value;
            document.getElementById('maxLabel').textContent = document.getElementById('maxTasks').value;
            document.getElementById('scaleOutLabel').textContent = document.getElementById('scaleOutCooldown').value;
            document.getElementById('scaleInLabel').textContent = document.getElementById('scaleInCooldown').value;
        }

        function addLog(message, type = 'info') {
            const logEl = document.getElementById('statusLog');
            const timestamp = new Date().toLocaleTimeString('ja-JP');
            const entry = document.createElement('div');
            entry.className = `log-entry ${type}`;
            entry.textContent = `[${timestamp}] ${message}`;
            logEl.insertBefore(entry, logEl.firstChild);

            // 最大100行まで保持
            while (logEl.children.length > 100) {
                logEl.removeChild(logEl.lastChild);
            }
        }

        function addAlert(message, type = 'info') {
            const container = document.getElementById('alertContainer');
            const alert = document.createElement('div');
            alert.className = `alert ${type}`;
            alert.innerHTML = `<div class="alert-icon">${getAlertIcon(type)}</div><div>${message}</div>`;
            container.appendChild(alert);

            // 5秒後に削除
            setTimeout(() => {
                if (alert.parentNode) {
                    alert.parentNode.removeChild(alert);
                }
            }, 5000);
        }

        function getAlertIcon(type) {
            const icons = { info: 'ℹ️', warning: '⚠️', error: '❌', success: '✅' };
            return icons[type] || '📢';
        }

        // =====================================
        // スケーリングロジック
        // =====================================
        function calculateDesiredTasks() {
            const config = getConfig();
            const backlog = simulationState.sqsBacklog;
            const current = simulationState.runningTasks;

            // Backlog per Task 計算
            const backlogPerTask = current > 0 ? Math.ceil(backlog / current) : 0;

            // 必要タスク数
            let desired = config.targetBacklog > 0
                ? Math.ceil(backlog / config.targetBacklog)
                : 0;

            // クラッピング
            desired = Math.max(config.minTasks, Math.min(desired, config.maxTasks));

            return { desired, backlogPerTask };
        }

        function tryAutoScale() {
            const config = getConfig();
            const { desired } = calculateDesiredTasks();
            const current = simulationState.runningTasks;
            const now = Date.now();

            if (desired > current) {
                // スケールアウト
                const timeSinceLastOut = (now - simulationState.lastScaleTime.out) / 1000;
                if (timeSinceLastOut >= config.scaleOutCooldown) {
                    simulationState.runningTasks = desired;
                    simulationState.lastScaleTime.out = now;
                    simulationState.totalScaled++;
                    addLog(`⬆️ スケールアウト: ${current} → ${desired} tasks`, 'success');
                    addAlert(`タスク数を ${current} から ${desired} に増加しました`, 'success');
                }
            } else if (desired < current) {
                // スケールイン
                const timeSinceLastIn = (now - simulationState.lastScaleTime.in) / 1000;
                if (timeSinceLastIn >= config.scaleInCooldown) {
                    simulationState.runningTasks = desired;
                    simulationState.lastScaleTime.in = now;
                    simulationState.totalScaled++;
                    addLog(`⬇️ スケールイン: ${current} → ${desired} tasks`, 'info');
                    addAlert(`タスク数を ${current} から ${desired} に削減しました`, 'info');
                }
            }
        }

        // =====================================
        // メッセージ処理シミュレーション
        // =====================================
        function processMessages() {
            if (simulationState.sqsBacklog <= 0 || simulationState.runningTasks <= 0) {
                return;
            }

            const config = getConfig();
            const msgPerSecond = (simulationState.runningTasks / config.processingTime);
            const processed = Math.min(simulationState.sqsBacklog, msgPerSecond);

            simulationState.sqsBacklog = Math.max(0, simulationState.sqsBacklog - processed);
            simulationState.totalProcessed += processed;

            if (processed > 0) {
                // 遅延計測（キュー深さに比例）
                const { backlogPerTask } = calculateDesiredTasks();
                const latency = backlogPerTask * config.processingTime * 1000; // ms
                simulationState.latencies.push(latency);
                if (simulationState.latencies.length > 60) {
                    simulationState.latencies.shift();
                }
            }
        }

        // =====================================
        // UI 更新
        // =====================================
        function updateUI() {
            const config = getConfig();
            const { desired, backlogPerTask } = calculateDesiredTasks();

            // メトリクス表示
            document.getElementById('sqsBacklog').textContent = simulationState.sqsBacklog;
            document.getElementById('runningTasks').textContent = simulationState.runningTasks;
            document.getElementById('backlogPerTask').textContent = backlogPerTask;

            // インジケータ
            const taskUsage = (simulationState.runningTasks / config.maxTasks) * 100;
            document.getElementById('taskUsageBar').style.width = taskUsage + '%';
            document.getElementById('taskUsagePercent').textContent = Math.round(taskUsage) + '%';

            const queueCapacity = Math.min(100, (simulationState.sqsBacklog / (config.maxTasks * 100)) * 100);
            document.getElementById('queueCapacityBar').style.width = queueCapacity + '%';
            document.getElementById('queueCapacityPercent').textContent = Math.round(queueCapacity) + '%';

            // 統計
            document.getElementById('totalProcessed').textContent = Math.round(simulationState.totalProcessed);
            document.getElementById('totalScaled').textContent = simulationState.totalScaled;

            // 平均遅延
            if (simulationState.latencies.length > 0) {
                const avgLatency = simulationState.latencies.reduce((a, b) => a + b, 0) / simulationState.latencies.length;
                document.getElementById('avgLatency').textContent = Math.round(avgLatency) + 'ms';
            }

            // コスト削減率（最小タスク数が低いほど削減率が高い）
            const baseCost = config.maxTasks * 100;
            const currentCost = simulationState.runningTasks * 100;
            const savings = Math.round(((baseCost - currentCost) / baseCost) * 100);
            document.getElementById('costSavings').textContent = Math.max(0, savings) + '%';

            // メトリクス履歴
            simulationState.metricsHistory.push({
                time: new Date(),
                backlog: simulationState.sqsBacklog,
                tasks: simulationState.runningTasks,
                backlogPerTask: backlogPerTask
            });

            if (simulationState.metricsHistory.length > MAX_HISTORY) {
                simulationState.metricsHistory.shift();
            }

            // グラフ更新
            updateChart();
        }

        // =====================================
        // グラフ描画（Canvas）
        // =====================================
        function updateChart() {
            const canvas = document.getElementById('metricsChart');
            const ctx = canvas.getContext('2d');
            const rect = canvas.getBoundingClientRect();
            const width = rect.width;
            const height = rect.height;

            // Canvas サイズを DPR に合わせる
            const dpr = window.devicePixelRatio || 1;
            canvas.width = width * dpr;
            canvas.height = height * dpr;
            ctx.scale(dpr, dpr);

            ctx.clearRect(0, 0, width, height);

            if (simulationState.metricsHistory.length < 2) {
                ctx.fillStyle = '#ccc';
                ctx.font = '14px sans-serif';
                ctx.textAlign = 'center';
                ctx.fillText('データを収集中...', width / 2, height / 2);
                return;
            }

            const history = simulationState.metricsHistory;
            const maxBacklog = Math.max(...history.map(h => h.backlog), 1);
            const maxTasks = Math.max(...history.map(h => h.tasks), 1);

            const padding = 40;
            const graphWidth = width - padding * 2;
            const graphHeight = height - padding * 2;

            // グリッドラインと軸ラベル
            ctx.strokeStyle = '#ddd';
            ctx.lineWidth = 1;
            ctx.fillStyle = '#999';
            ctx.font = '11px sans-serif';

            for (let i = 0; i <= 5; i++) {
                const y = padding + (graphHeight / 5) * i;
                ctx.beginPath();
                ctx.moveTo(padding, y);
                ctx.lineTo(width - padding, y);
                ctx.stroke();
                const val = Math.round(maxBacklog - (maxBacklog / 5) * i);
                ctx.textAlign = 'right';
                ctx.fillText(val, padding - 10, y + 3);
            }

            // SQS滞留数（青）
            ctx.strokeStyle = '#4facfe';
            ctx.lineWidth = 2;
            ctx.beginPath();
            history.forEach((point, idx) => {
                const x = padding + (graphWidth / (history.length - 1)) * idx;
                const y = padding + graphHeight - (point.backlog / maxBacklog) * graphHeight;
                if (idx === 0) {
                    ctx.moveTo(x, y);
                } else {
                    ctx.lineTo(x, y);
                }
            });
            ctx.stroke();

            // 実行タスク数（紫、右スケール）
            ctx.strokeStyle = '#667eea';
            ctx.lineWidth = 2;
            ctx.beginPath();
            history.forEach((point, idx) => {
                const x = padding + (graphWidth / (history.length - 1)) * idx;
                const y = padding + graphHeight - (point.tasks / maxTasks) * graphHeight;
                if (idx === 0) {
                    ctx.moveTo(x, y);
                } else {
                    ctx.lineTo(x, y);
                }
            });
            ctx.stroke();

            // Backlog per Task（赤）
            ctx.strokeStyle = '#f5576c';
            ctx.lineWidth = 2;
            ctx.beginPath();
            const maxBacklogPerTask = Math.max(...history.map(h => h.backlogPerTask), 1);
            history.forEach((point, idx) => {
                const x = padding + (graphWidth / (history.length - 1)) * idx;
                const y = padding + graphHeight - (point.backlogPerTask / maxBacklogPerTask) * graphHeight;
                if (idx === 0) {
                    ctx.moveTo(x, y);
                } else {
                    ctx.lineTo(x, y);
                }
            });
            ctx.stroke();

            // 凡例
            ctx.font = 'bold 12px sans-serif';
            ctx.textAlign = 'left';
            let legendY = 15;
            ctx.fillStyle = '#4facfe';
            ctx.fillRect(10, legendY, 12, 12);
            ctx.fillStyle = '#333';
            ctx.fillText('SQS滞留数', 28, legendY + 10);

            legendY += 20;
            ctx.fillStyle = '#667eea';
            ctx.fillRect(10, legendY, 12, 12);
            ctx.fillStyle = '#333';
            ctx.fillText('実行タスク数', 28, legendY + 10);

            legendY += 20;
            ctx.fillStyle = '#f5576c';
            ctx.fillRect(10, legendY, 12, 12);
            ctx.fillStyle = '#333';
            ctx.fillText('Backlog/Task', 28, legendY + 10);
        }

        // =====================================
        // シミュレーション ループ
        // =====================================
        function simulationTick() {
            if (!simulationState.isRunning) {
                return;
            }

            processMessages();
            tryAutoScale();
            updateUI();

            // 警告チェック
            const { backlogPerTask } = calculateDesiredTasks();
            const config = getConfig();
            if (backlogPerTask > config.targetBacklog * 1.5) {
                addAlert(`⚠️ Backlog per Task が高い: ${backlogPerTask}件/task (ターゲット: ${config.targetBacklog})`, 'warning');
            }
            if (simulationState.runningTasks === config.maxTasks && simulationState.sqsBacklog > 0) {
                addAlert(`⚠️ 最大タスク数に達しました。キュー滞留あり: ${simulationState.sqsBacklog}件`, 'error');
            }

            setTimeout(simulationTick, 1000);
        }

        // =====================================
        // シナリオ実行
        // =====================================
        function runScenario(scenario) {
            const config = getConfig();
            simulationState.isRunning = true;

            addLog(`🎬 シナリオ開始: ${scenario}`, 'info');

            switch (scenario) {
                case 'normal':
                    // 通常流：30秒間、毎秒5～10件
                    for (let i = 0; i < 30; i++) {
                        setTimeout(() => {
                            const msgs = Math.floor(Math.random() * 6) + 5;
                            simulationState.sqsBacklog += msgs;
                        }, i * 1000);
                    }
                    break;

                case 'spike':
                    // スパイク：一気に200件投入 → 処理
                    simulationState.sqsBacklog += 200;
                    addLog(`📈 スパイク: 200件投入`, 'warning');
                    break;

                case 'gradual':
                    // 段階的：0→50→100→150→0
                    const stages = [0, 50, 100, 150, 0];
                    let stage = 0;
                    const interval = setInterval(() => {
                        if (stage >= stages.length || !simulationState.isRunning) {
                            clearInterval(interval);
                            return;
                        }
                        simulationState.sqsBacklog = stages[stage];
                        addLog(`段階 ${stage + 1}: ${stages[stage]}件`, 'info');
                        stage++;
                    }, 5000);
                    break;
            }

            simulationTick();
        }

        function addMessages(count) {
            simulationState.sqsBacklog += count;
            simulationState.isRunning = true;
            addLog(`➕ ${count}件追加`, 'info');
            simulationTick();
        }

        function stopSimulation() {
            simulationState.isRunning = false;
            addLog(`⏹ シミュレーション停止`, 'warning');
        }

        function reset() {
            simulationState = {
                sqsBacklog: 0,
                runningTasks: 0,
                totalProcessed: 0,
                totalScaled: 0,
                lastScaleTime: { out: 0, in: 0 },
                isRunning: false,
                simulationStart: Date.now(),
                metricsHistory: [],
                alerts: [],
                latencies: []
            };
            document.getElementById('statusLog').innerHTML = '';
            document.getElementById('alertContainer').innerHTML = '';
            updateUI();
            addLog('🔄 リセット完了', 'success');
        }

        // =====================================
        // タブ切替
        // =====================================
        function switchTab(tabName) {
            // ボタン切替
            document.querySelectorAll('.tab-button').forEach(btn => {
                btn.classList.remove('active');
            });
            event.target.classList.add('active');

            // コンテンツ切替
            document.querySelectorAll('.tab-content').forEach(content => {
                content.classList.remove('active');
            });
            document.getElementById(tabName).classList.add('active');

            // コード生成
            if (tabName === 'cdk') {
                generateCdkCode();
            } else if (tabName === 'terraform') {
                generateTerraformCode();
            } else if (tabName === 'ecs-task') {
                generateEcsTaskCode();
            } else if (tabName === 'export') {
                generateCfnExport();
            }
        }

        // =====================================
        // コード生成関数
        // =====================================
        function generateCdkCode() {
            const config = getConfig();
            const code = `<span class="comment">// cdk/lib/scaling-stack.ts</span>
<span class="keyword">import</span> * <span class="keyword">as</span> cdk <span class="keyword">from</span> <span class="string">'aws-cdk-lib'</span>;
<span class="keyword">import</span> * <span class="keyword">as</span> ecs <span class="keyword">from</span> <span class="string">'aws-cdk-lib/aws-ecs'</span>;
<span class="keyword">import</span> * <span class="keyword">as</span> autoscaling <span class="keyword">from</span> <span class="string">'aws-cdk-lib/aws-applicationautoscaling'</span>;
<span class="keyword">import</span> * <span class="keyword">as</span> cloudwatch <span class="keyword">from</span> <span class="string">'aws-cdk-lib/aws-cloudwatch'</span>;

<span class="keyword">export</span> <span class="keyword">class</span> ScalingStack <span class="keyword">extends</span> cdk.Stack {
  <span class="keyword">constructor</span>(scope: cdk.App, id: <span class="keyword">string</span>, props?: cdk.StackProps) {
    <span class="keyword">super</span>(scope, id, props);

    <span class="comment">// Application Auto Scaling ターゲット</span>
    <span class="keyword">const</span> scalingTarget = <span class="keyword">new</span> autoscaling.ScalableTarget(
      <span class="keyword">this</span>,
      <span class="string">'ECSServiceScalingTarget'</span>,
      {
        serviceNamespace: autoscaling.ServiceNamespace.ECS,
        resourceId: <span class="string">'service/fargate-cluster/batch-worker'</span>,
        scalableDimension: <span class="string">'ecs:service:DesiredCount'</span>,
        minCapacity: <span class="number">${config.minTasks}</span>,
        maxCapacity: <span class="number">${config.maxTasks}</span>
      }
    );

    <span class="comment">// Metric Math: Backlog per Task</span>
    <span class="keyword">const</span> backlogPerTaskMetric = <span class="keyword">new</span> cloudwatch.Metric({
      namespace: <span class="string">'AWS/SQS'</span>,
      metricName: <span class="string">'BacklogPerTask'</span>,
      period: cdk.Duration.minutes(<span class="number">1</span>),
      statistic: <span class="string">'Average'</span>
    });

    <span class="comment">// Target Tracking Scaling Policy</span>
    scalingTarget.scaleToTrackMetric(
      <span class="string">'BacklogPerTaskScaling'</span>,
      {
        targetValue: <span class="number">${config.targetBacklog}</span>,
        predefinedMetric: undefined,
        customMetric: backlogPerTaskMetric,
        scaleOutCooldown: cdk.Duration.seconds(<span class="number">${config.scaleOutCooldown}</span>),
        scaleInCooldown: cdk.Duration.seconds(<span class="number">${config.scaleInCooldown}</span>)
      }
    );

    <span class="comment">// CloudWatch ダッシュボード</span>
    <span class="keyword">new</span> cloudwatch.Dashboard(<span class="keyword">this</span>, <span class="string">'BacklogAutoScalingDashboard'</span>, {
      dashboardName: <span class="string">'backlog-autoscaling'</span>
    }).addWidgets(
      <span class="keyword">new</span> cloudwatch.GraphWidget({
        title: <span class="string">'SQS Backlog &amp; Task Count'</span>,
        left: [
          <span class="keyword">new</span> cloudwatch.Metric({
            namespace: <span class="string">'AWS/SQS'</span>,
            metricName: <span class="string">'ApproximateNumberOfMessagesVisible'</span>,
            period: cdk.Duration.seconds(<span class="number">60</span>)
          })
        ],
        right: [
          <span class="keyword">new</span> cloudwatch.Metric({
            namespace: <span class="string">'AWS/ECS'</span>,
            metricName: <span class="string">'RunningTaskCount'</span>,
            period: cdk.Duration.seconds(<span class="number">60</span>)
          })
        ]
      })
    );
  }
}`;

            document.getElementById('cdkCode').innerHTML = code;
        }

        function generateTerraformCode() {
            const config = getConfig();
            const code = `<span class="comment"># terraform/ssm.tf - パラメータストア連携</span>

resource <span class="string">"aws_ssm_parameter"</span> <span class="string">"scaling_config"</span> {
  name  = <span class="string">"/backlog-scaling/config"</span>
  type  = <span class="string">"String"</span>
  value = jsonencode({
    target_backlog      = <span class="number">${config.targetBacklog}</span>
    min_tasks           = <span class="number">${config.minTasks}</span>
    max_tasks           = <span class="number">${config.maxTasks}</span>
    scale_out_cooldown  = <span class="number">${config.scaleOutCooldown}</span>
    scale_in_cooldown   = <span class="number">${config.scaleInCooldown}</span>
    processing_time_sec = <span class="number">${config.processingTime}</span>
  })
}

<span class="comment"># CDK stack で参照</span>
data <span class="string">"aws_ssm_parameter"</span> <span class="string">"scaling_config"</span> {
  name = aws_ssm_parameter.scaling_config.name
}

output <span class="string">"scaling_config"</span> {
  value = data.aws_ssm_parameter.scaling_config.value
}`;

            document.getElementById('terraformCode').innerHTML = code;
        }

        function generateEcsTaskCode() {
            const code = `<span class="comment">// ecs-worker/index.js - Node.js ワーカー実装</span>

<span class="keyword">const</span> AWS = <span class="keyword">require</span>(<span class="string">'aws-sdk'</span>);
<span class="keyword">const</span> sqs = <span class="keyword">new</span> AWS.SQS();

<span class="keyword">const</span> QUEUE_URL = process.env.SQS_QUEUE_URL;
<span class="keyword">const</span> VISIBILITY_TIMEOUT = <span class="number">300</span>; <span class="comment">// 5分</span>
<span class="keyword">let</span> isShuttingDown = <span class="keyword">false</span>;
<span class="keyword">let</span> activeMessage = <span class="keyword">null</span>;

<span class="comment">// SIGTERM ハンドリング（グレースフルシャットダウン）</span>
process.on(<span class="string">'SIGTERM'</span>, <span class="keyword">async</span> () => {
  console.log(<span class="string">'📴 SIGTERM 受信 - グレースフルシャットダウン開始'</span>);
  isShuttingDown = <span class="keyword">true</span>;

  <span class="comment">// 現在処理中のメッセージ完了待機（最長30秒）</span>
  <span class="keyword">const</span> startTime = Date.now();
  <span class="keyword">while</span> (activeMessage &amp;&amp; Date.now() - startTime &lt; <span class="number">30000</span>) {
    <span class="keyword">await</span> <span class="keyword">new</span> Promise(resolve =&gt; setTimeout(resolve, <span class="number">100</span>));
  }

  console.log(<span class="string">'✅ シャットダウン完了'</span>);
  process.exit(<span class="number">0</span>);
});

<span class="comment">// メッセージ受信・処理ループ</span>
<span class="keyword">async</span> <span class="keyword">function</span> pollMessages() {
  <span class="keyword">while</span> (!isShuttingDown) {
    <span class="keyword">try</span> {
      <span class="keyword">const</span> params = {
        QueueUrl: QUEUE_URL,
        MaxNumberOfMessages: <span class="number">10</span>,
        VisibilityTimeout: VISIBILITY_TIMEOUT,
        WaitTimeSeconds: <span class="number">20</span> <span class="comment">// Long Polling</span>
      };

      <span class="keyword">const</span> data = <span class="keyword">await</span> sqs.receiveMessage(params).promise();
      <span class="keyword">if</span> (!data.Messages) {
        <span class="keyword">continue</span>;
      }

      <span class="keyword">for</span> (<span class="keyword">const</span> message <span class="keyword">of</span> data.Messages) {
        activeMessage = message;
        <span class="keyword">try</span> {
          <span class="comment">// メッセージ処理</span>
          <span class="keyword">const</span> body = JSON.parse(message.Body);
          <span class="keyword">await</span> processMessage(body);

          <span class="comment">// 成功時に削除</span>
          <span class="keyword">await</span> sqs.deleteMessage({
            QueueUrl: QUEUE_URL,
            ReceiptHandle: message.ReceiptHandle
          }).promise();

          console.log(<span class="string">'✅ メッセージ処理完了'</span>);
        } <span class="keyword">catch</span> (err) {
          console.error(<span class="string">'❌ 処理エラー'</span>, err);
          <span class="comment">// エラー時は DLQ へ移動（設定済みなら自動）</span>
        } <span class="keyword">finally</span> {
          activeMessage = <span class="keyword">null</span>;
        }
      }
    } <span class="keyword">catch</span> (err) {
      console.error(<span class="string">'⚠️ ポーリングエラー'</span>, err);
      <span class="keyword">await</span> <span class="keyword">new</span> Promise(resolve =&gt; setTimeout(resolve, <span class="number">1000</span>));
    }
  }
}

<span class="keyword">async</span> <span class="keyword">function</span> processMessage(body) {
  <span class="comment">// 実装例: バッチ処理、API呼び出し等</span>
  console.log(<span class="string">'🔄 処理中:'</span>, body);
  <span class="keyword">await</span> <span class="keyword">new</span> Promise(r =&gt; setTimeout(r, <span class="number">2000</span>));
}

<span class="comment">// 起動</span>
console.log(<span class="string">'🚀 ワーカー起動'</span>);
pollMessages().catch(console.error);`;

            document.getElementById('ecsTaskCode').innerHTML = code;
        }

        function generateCfnExport() {
            const config = getConfig();
            const cfnTemplate = {
                AWSTemplateFormatVersion: '2010-09-09',
                Description: 'SQS Backlog-based Auto Scaling for ECS Fargate',
                Parameters: {
                    TargetBacklog: {
                        Type: 'Number',
                        Default: config.targetBacklog,
                        Description: 'Target backlog per task'
                    },
                    MinTasks: {
                        Type: 'Number',
                        Default: config.minTasks,
                        Description: 'Minimum number of tasks'
                    },
                    MaxTasks: {
                        Type: 'Number',
                        Default: config.maxTasks,
                        Description: 'Maximum number of tasks'
                    }
                },
                Resources: {
                    ScalingTarget: {
                        Type: 'AWS::ApplicationAutoScaling::ScalableTarget',
                        Properties: {
                            MaxCapacity: { Ref: 'MaxTasks' },
                            MinCapacity: { Ref: 'MinTasks' },
                            ResourceId: 'service/fargate-cluster/batch-worker',
                            RoleARN: 'arn:aws:iam::ACCOUNT_ID:role/ecsAutoscalingRole',
                            ScalableDimension: 'ecs:service:DesiredCount',
                            ServiceNamespace: 'ecs'
                        }
                    },
                    ScalingPolicy: {
                        Type: 'AWS::ApplicationAutoScaling::ScalingPolicy',
                        Properties: {
                            PolicyName: 'BacklogPerTaskScaling',
                            PolicyType: 'TargetTrackingScaling',
                            ScalingTargetId: { Ref: 'ScalingTarget' },
                            TargetTrackingScalingPolicyConfiguration: {
                                TargetValue: { Ref: 'TargetBacklog' },
                                PredefinedMetricSpecification: {
                                    PredefinedMetricType: 'ALBRequestCountPerTarget'
                                },
                                ScaleOutCooldown: 60,
                                ScaleInCooldown: 300
                            }
                        }
                    }
                },
                Outputs: {
                    ScalingTargetId: {
                        Value: { Ref: 'ScalingTarget' }
                    }
                }
            };

            const code = `<span class="comment">// CloudFormation Template JSON</span>
${JSON.stringify(cfnTemplate, null, 2).replace(/"/g, '<span class="string">"</span>').replace(/:/g, '<span class="keyword">:</span>')}`;

            document.getElementById('cfnExportCode').innerHTML = code;
        }

        // =====================================
        // コピー機能
        // =====================================
        function copyCdkCode() {
            copyToClipboard(stripHtml(document.getElementById('cdkCode').innerHTML));
        }

        function copyTerraformCode() {
            copyToClipboard(stripHtml(document.getElementById('terraformCode').innerHTML));
        }

        function copyEcsTaskCode() {
            copyToClipboard(stripHtml(document.getElementById('ecsTaskCode').innerHTML));
        }

        function copyCfnCode() {
            copyToClipboard(stripHtml(document.getElementById('cfnExportCode').innerHTML));
        }

        function copyToClipboard(text) {
            navigator.clipboard.writeText(text).then(() => {
                addAlert('📋 コピーしました', 'success');
            }).catch(err => {
                addAlert('❌ コピー失敗', 'error');
            });
        }

        function stripHtml(html) {
            const div = document.createElement('div');
            div.innerHTML = html;
            return div.textContent || div.innerText || '';
        }

        function downloadCfnJson() {
            const config = getConfig();
            const cfn = {
                AWSTemplateFormatVersion: '2010-09-09',
                Description: 'SQS Backlog AutoScaling Configuration',
                Parameters: {
                    TargetBacklog: { Type: 'Number', Default: config.targetBacklog },
                    MinTasks: { Type: 'Number', Default: config.minTasks },
                    MaxTasks: { Type: 'Number', Default: config.maxTasks }
                }
            };

            const json = JSON.stringify(cfn, null, 2);
            const blob = new Blob([json], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'backlog-scaling-template.json';
            a.click();
        }

        // =====================================
        // ヘルプモーダル
        // =====================================
        function showHelp() {
            document.getElementById('helpModal').classList.add('active');
        }

        function closeHelp() {
            document.getElementById('helpModal').classList.remove('active');
        }

        // =====================================
        // 初期化
        // =====================================
        document.getElementById('targetBacklog').addEventListener('input', updateLabels);
        document.getElementById('minTasks').addEventListener('input', updateLabels);
        document.getElementById('maxTasks').addEventListener('input', updateLabels);
        document.getElementById('scaleOutCooldown').addEventListener('input', updateLabels);
        document.getElementById('scaleInCooldown').addEventListener('input', updateLabels);

        // 初期表示
        updateLabels();
        updateUI();
        generateCdkCode();

        // 定期更新（シミュレーション非実行時）
        setInterval(() => {
            if (!simulationState.isRunning) {
                updateUI();
            }
        }, 500);