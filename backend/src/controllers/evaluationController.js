import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { recordAuditLog } from '../services/auditService.js';

const execFileAsync = promisify(execFile);

const REPORT_JSON_PATH = path.resolve(process.cwd(), 'docs', 'evaluation-report.json');

export async function getLatestEvaluation(_req, res) {
  try {
    if (!fs.existsSync(REPORT_JSON_PATH)) {
      return res.json({ report: null });
    }
    const raw = fs.readFileSync(REPORT_JSON_PATH, 'utf8');
    return res.json({ report: JSON.parse(raw) });
  } catch (error) {
    console.error('Get evaluation report error:', error);
    return res.status(500).json({ error: 'Failed to load evaluation report.' });
  }
}

export async function triggerLiveEvaluation(req, res) {
  try {
    const trials = Math.max(2, Math.min(10, Number(req.body?.trials) || 5));
    const scriptPath = path.resolve(process.cwd(), 'backend', 'src', 'scripts', 'runEvaluation.js');

    const { stdout } = await execFileAsync(
      process.execPath,
      [scriptPath, `--trials=${trials}`, '--json'],
      {
        cwd: process.cwd(),
        timeout: 120000,
        maxBuffer: 4 * 1024 * 1024,
      }
    );

    const report = JSON.parse(stdout.trim().split('\n').pop());

    await recordAuditLog({
      actorId: req.user.id,
      actorRole: req.user.roleCode,
      action: 'EVALUATION_SUITE_EXECUTED',
      entityType: 'system_evaluation',
      entityId: 'phase-11-benchmarks',
      details: {
        trials,
        allScenariosPassed: report.allScenariosPassed,
        generatedAt: report.generatedAt,
      },
      ipAddress: req.ip,
    });

    return res.json({
      message: `Completed 4 fraud scenarios and ${trials}-trial subsystem benchmarks.`,
      report,
    });
  } catch (error) {
    console.error('Trigger live evaluation error:', error);
    return res.status(500).json({ error: 'Failed to execute live evaluation suite.' });
  }
}
