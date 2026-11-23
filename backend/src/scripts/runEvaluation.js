import fs from 'node:fs';
import path from 'node:path';
import {
  runFourFraudScenarios,
  runPerformanceBenchmarks,
} from '../services/evaluationService.js';

function formatMarkdownReport(report) {
  const lines = [
    '# ANAGU Prototype Evaluation: Fraud Simulations & Performance Benchmarks',
    '',
    `> **Measured Run Timestamp:** \`${report.generatedAt}\`  `,
    `> **Environment:** Node \`${report.benchmarks.environment.nodeVersion}\` (${report.benchmarks.environment.platform}/${report.benchmarks.environment.arch}) · ${report.benchmarks.environment.evmEngine} · ${report.benchmarks.environment.mqttEngine}`,
    '',
    '## 1. Automated Fraud & Attack Prevention Scenarios (4/4)',
    '',
    '| Scenario | Outcome | HTTP Status | Measured Latency (ms) | Evidence |',
    '| --- | --- | --- | --- | --- |',
  ];

  for (const s of report.scenarios) {
    lines.push(
      `| ${s.title} | ${s.passed ? 'PASS — ' : 'FAIL — '}${s.outcome} | \`${s.httpStatus}\` | \`${s.latencyMs}\` | ${s.evidence} |`
    );
  }

  lines.push(
    '',
    `## 2. Repeated-Trial Subsystem Benchmarks (${report.benchmarks.trials} Trials Each)`,
    '',
    '| Subsystem | Trials | Min (ms) | Mean (ms) | Max (ms) | Avg EVM Gas |',
    '| --- | --- | --- | --- | --- | --- |'
  );

  for (const b of report.benchmarks.subsystems) {
    lines.push(
      `| ${b.label} | ${b.trials} | \`${b.minMs}\` | \`${b.meanMs}\` | \`${b.maxMs}\` | ${
        b.avgGasUsed !== null ? `\`${b.avgGasUsed.toLocaleString()}\`` : 'N/A'
      } |`
    );
  }

  lines.push(
    '',
    '## 3. Measured Storage Footprint',
    '',
    `- **Prototype Store Size after ${report.benchmarks.trials} Full Lifecycles:** \`${report.benchmarks.storage.prototypeStoreBytes.toLocaleString()} bytes\` (${(
      report.benchmarks.storage.prototypeStoreBytes / 1024
    ).toFixed(2)} KB)`,
    `- **Total Database Records:** \`${report.benchmarks.storage.totalRecordsStored}\``,
    `- **Average Footprint per Record:** \`${report.benchmarks.storage.avgBytesPerRecord} bytes\``,
    `- **Sample ERC-721 Metadata Payload Size:** \`${report.benchmarks.storage.sampleTitleMetadataBytes} bytes\``,
    ''
  );

  return lines.join('\n');
}

async function main() {
  const trialsArg = process.argv.find((a) => a.startsWith('--trials='));
  const trials = trialsArg ? Number(trialsArg.split('=')[1]) : 5;
  const jsonOnly = process.argv.includes('--json');

  const scenarios = await runFourFraudScenarios();
  const benchmarks = await runPerformanceBenchmarks({ trials });

  const report = {
    generatedAt: new Date().toISOString(),
    allScenariosPassed: scenarios.every((s) => s.passed),
    scenarios,
    benchmarks,
  };

  const docsDir = path.resolve(process.cwd(), 'docs');
  if (!fs.existsSync(docsDir)) {
    fs.mkdirSync(docsDir, { recursive: true });
  }

  fs.writeFileSync(
    path.join(docsDir, 'evaluation-report.json'),
    JSON.stringify(report, null, 2),
    'utf8'
  );
  fs.writeFileSync(
    path.join(docsDir, 'benchmarks-and-fraud-report.md'),
    formatMarkdownReport(report),
    'utf8'
  );

  if (jsonOnly) {
    console.log(JSON.stringify(report));
  } else {
    console.log('ANAGU Fraud Scenarios & Benchmark Evaluation Complete');
    console.log(`All 4 Fraud Scenarios Passed: ${report.allScenariosPassed}`);
    for (const s of scenarios) {
      console.log(` - [${s.passed ? 'PASS' : 'FAIL'}] ${s.title} -> ${s.outcome} (${s.latencyMs} ms)`);
    }
    console.log(`\nSubsystem Benchmarks (${benchmarks.trials} trials):`);
    for (const b of benchmarks.subsystems) {
      console.log(
        ` - ${b.label}: min=${b.minMs}ms mean=${b.meanMs}ms max=${b.maxMs}ms${
          b.avgGasUsed ? ` gas=${b.avgGasUsed}` : ''
        }`
      );
    }
    console.log('\nSaved reports to docs/evaluation-report.json and docs/benchmarks-and-fraud-report.md');
  }
}

main().catch((err) => {
  console.error('Evaluation runner failed:', err);
  process.exit(1);
});
