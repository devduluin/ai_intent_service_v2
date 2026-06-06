import assert from 'assert';
import { detectEmotion } from '../src/utils/emotion-detector.util';
import { emotionToneService } from '../src/services/emotion-tone.service';

function main() {
  assert.equal(detectEmotion('cek PNL hari ini').emotion, 'neutral');
  assert.equal(detectEmotion('export XLS').emotion, 'neutral');
  assert.equal(detectEmotion('company_id ABC123').emotion, 'neutral');

  const urgent = detectEmotion('TOLONG CEPAT cek kendaraan exit sekarang!!');
  assert.equal(urgent.emotion, 'urgent');
  assert.ok(urgent.intensity >= 0.8);

  const frustrated = detectEmotion('kok error terus sih!! sudah 3x coba');
  assert.equal(frustrated.emotion, 'frustrated');

  const confused = detectEmotion('maksudnya gimana sih caranya?');
  assert.equal(confused.emotion, 'confused');

  const satisfied = detectEmotion('makasih, sangat membantu!');
  assert.equal(satisfied.emotion, 'satisfied');

  const instruction = emotionToneService.buildSystemInstruction(urgent);
  assert.ok(instruction.includes('tidak boleh melewati confirmation'));

  const adapted = emotionToneService.adaptShortMessage('Mohon isi company_id.', frustrated);
  assert.ok(adapted.startsWith('Saya paham ini mengganggu.'));

  console.log('emotional-intelligence-smoke: PASS');
}

main();
