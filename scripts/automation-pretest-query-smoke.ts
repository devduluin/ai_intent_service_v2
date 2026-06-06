import { automationPretestService } from '../src/services/automation/automation-pretest.service';

function assertEqual(actual: string, expected: string, message: string): void {
  if (actual !== expected) {
    throw new Error(`${message}. Expected "${expected}", got "${actual}"`);
  }
}

const query = automationPretestService.buildEvaluationQuery({
  type: 'scheduled_workflow',
  goal: 'laporkan ini tiap hari jam 7 malam',
  workflow: {
    sourceText: 'laporkan ini tiap hari jam 7 malam',
    referencedSourceText: 'cek kendaraan exit hari ini'
  }
});

assertEqual(query, 'cek kendaraan exit hari ini', 'Referenced pretest query should use previous execution source');

const thresholdQuery = automationPretestService.buildEvaluationQuery({
  type: 'conditional_alert',
  goal: 'conditional alert kalau kendaraan exit lebih dari 1 unit',
  condition: {
    kind: 'threshold',
    sourceText: 'kalau kendaraan exit lebih dari 1 unit'
  },
  workflow: {
    sourceText: 'conditional alert kalau kendaraan exit lebih dari 1 unit'
  }
});

assertEqual(thresholdQuery, 'cek kendaraan exit', 'Threshold pretest query should strip condition operator');

console.log('[automation-pretest-query-smoke] PASS', {
  referenced: query,
  threshold: thresholdQuery
});

