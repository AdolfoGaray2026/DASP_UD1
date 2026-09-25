"""Bundle the original board and revised UD1 questions for offline play."""
from pathlib import Path
import json
BASE = Path(__file__).resolve().parent
board = json.loads((BASE/'tablero_web.json').read_text(encoding='utf-8'))
cards = json.loads((BASE/'cartas_revisadas.json').read_text(encoding='utf-8'))
assert len(board) == 19 and len(cards) == 36
payload = {'board': board, 'cards': cards}
(BASE/'data.js').write_text('window.CONECTA_DATA = '+json.dumps(payload, ensure_ascii=False, separators=(',', ':'))+';\n', encoding='utf-8')
print('Tablero original: 19 hexágonos; banco revisado: 36 retos; data.js generado')
