import barMap from './recording-bars.json' with { type: 'json' };

export const songs = {
  breathe: { name: 'Breathe (In the Air)', file: 'breathe-2023.flac', tonic: 64, tonicName: 'E', six: 'C♯', flat: 'C' },
  colour: { name: 'Any Colour You Like', file: 'any-colour-2023.flac', tonic: 62, tonicName: 'D', six: 'B', flat: 'B♭' },
  gig: { name: 'The Great Gig in the Sky', file: 'great-gig-2023.flac', tonic: 67, tonicName: 'G', six: 'E', flat: 'E♭' },
};

const loop = (from, count, a, b) => Array.from({ length: count }, (_, i) => [from + i, i % 2 ? b : a]);
const outside = (bar, symbol, label = '离开 Dorian') => [bar, symbol, 'chromatic', label];

// Positions count bars from each excerpt's first downbeat. Fractions mark beats within that bar.
const edits = [
  {
    id: 'breathe-vamp', song: 'breathe', excerptId: 'breathe-vamp', endBar: 9,
    subtitle: 'E Dorian · 听电钢琴怎样改变小调色彩',
    harmony: [[0, 'Em(add9)'], [1, 'A7'], ...loop(2, 7, 'Em9', 'A7')],
    cues: [
      [0, '先跟住电钢琴左手的 E　听低音第一次换到哪里'],
      [1, '低音到了 A　留意吉他里的 C♯　它是 A7 的大三度'],
      [2, 'A7 又回到 Em　下一轮再听一次这个回落'],
      [4, '先听滑棒的长音　再把注意力移到下面一颗颗分开的吉他音'],
      [7, '同一个 C♯　放在 A7 里是三音　放回 E 小调中心就是自然六级'],
    ],
  },
  {
    id: 'breathe-chorus', song: 'breathe', excerptId: 'breathe-chorus', endBar: 7.75,
    subtitle: 'E Dorian · 半音下行与人声进入',
    harmony: [[0, 'Em9'], [1, 'A7'], outside(2, 'Cmaj7'), outside(3, 'Bm7'), outside(4, 'Fmaj7'),
      outside(5, 'G'), outside(5.5, 'D7#9'), outside(5.75, 'D#dim7'), [6, 'Em7'], [7, 'A7']],
    cues: [
      [0, '再听一轮 Em 和 A7　先记住那个 C♯'],
      [2, 'C♯ 降到 C♮　Cmaj7 和前面的 Em 共享 E、G、B　颜色却已经换了'],
      [4, 'Fmaj7 又带来 F♮　听接下来的和弦怎样越换越快'],
      [6, '低音回到 E　第一句人声从这轮 Em7 里进来'],
    ],
  },
  {
    id: 'colour-handover', song: 'colour', excerptId: 'acyl-handover', endBar: 19,
    subtitle: 'D Dorian · 合成器与吉他交接',
    harmony: loop(0, 19, 'Dm7', 'G7'),
    cues: [
      [0, '听合成器一句刚落下　右侧的回声还在重复刚才的音头'],
      [4, '这次只听风琴　Dm7 上的 C 下一小节降到 B　余音还叠在上面'],
      [9, '把 B 和 G7 放在一起听　这个明亮的大三度也是 D 的自然六级'],
      [13, '再过一小节　听前景的音头怎样从合成器换成拨弦'],
      [14, '吉他已经接手　下面的 Dm7 与 G7 还在原处交替'],
    ],
  },
  {
    id: 'colour-solo', song: 'colour', excerptId: 'acyl-solo', endBar: 11,
    subtitle: 'D Dorian · 先听推弦　再听半音滑落',
    harmony: loop(0, 11, 'Dm7', 'G7'),
    cues: [
      [0, '看三弦 12 品　手留在 G 的品位上　音高却被推向 A'],
      [1, '和弦换到 G7　二弦的 C 滑到 B　听它和风琴里的 B 合在一起'],
      [2, '再听低一个八度的 B3　同一个音名换了弦　也换了音色'],
      [4, '双音推弦时跟住一个音头　弦的位移和听到的音高一起变化'],
      [8, '这次先听余音　揉弦围着一个音摆动　滑音才落到另一个品位'],
    ],
  },
  {
    id: 'colour-outro', song: 'colour', excerptId: 'acyl-outro', endBar: 7.75,
    subtitle: 'D Dorian · 最后一次听 B',
    harmony: [...loop(0, 4, 'Dm7', 'G7'), outside(4, 'Bbmaj7'), outside(5, 'Am7'),
      outside(6, 'Ebmaj7'), outside(7, 'F'), outside(7.5, 'C7#9', '转向下一轨')],
    cues: [
      [0, '先在风琴里找 B　前面几十小节一直靠它点亮 G7'],
      [4, '这次等到的是 B♭　只降半音　原来的 Dm7 与 G7 循环就停住了'],
      [6, '再听低音落到 E♭　耳朵已经离开开头的 D 中心'],
    ],
  },
  {
    id: 'gig-entry', song: 'gig', excerptId: 'gig-entry', endBar: 11,
    subtitle: '局部 G Dorian · 钢琴里只动了哪一个音',
    harmony: [outside(0, 'Bbmaj7', 'B♭ 大调'), outside(0.5, 'Ebmaj7', 'B♭ 大调'),
      outside(1, 'Bb', 'A 段终止'), outside(2, 'Bb', 'A 段终止'), ...loop(3, 8, 'Gm7', 'C9')],
    cues: [
      [0, '先听钢琴收在 B♭　下一段的 G 小调中心还没有出现'],
      [3, '人声进来时先跟钢琴右手　记住 Gm7 里的 F'],
      [4, 'F 落到 E♮　G、B♭、D 留住　听这一个半音怎样把 Gm7 接到 C9'],
      [6, '再听一次　左手 G 与 C 交替　人声从这两组和弦上方穿过'],
      [9, '这次跟人声走　下方的钢琴仍会按同样的顺序换色'],
    ],
  },
  {
    id: 'gig-exit', song: 'gig', excerptId: 'gig-exit', endBar: 7,
    subtitle: '局部 G Dorian · 跟着左手走出循环',
    harmony: [[0, 'C9'], [1, 'Gm7'], [2, 'C9'], outside(3, 'Gm7/D'),
      outside(3.5, 'Gm7b5/Db'), outside(4, 'Gb7'), outside(4.5, 'Bm', '回到 A 段 B 小调')],
    cues: [
      [0, '最后再听一轮 C9 与 Gm7　这次把注意力留给钢琴左手'],
      [3, '低音先停在 D　再往下挪半音　听 D♭ 在上方和弦下面经过'],
      [4.5, '落到 Bm 后力度收了回来　钢琴的分解音重新走到前面'],
    ],
  },
  {
    id: 'gig-b2', song: 'gig', excerptId: 'gig-b2',
    subtitle: '局部 G Dorian · 在较轻的再现里找回 E♮',
    harmony: [outside(0, 'Bb', 'A 段终止'), outside(1, 'Bb', 'A 段终止'), ...loop(2, 6, 'Gm7', 'C9')],
    cues: [
      [0, '钢琴再次收在 B♭　听下一次低音换到 G 的瞬间'],
      [2, 'Gm7 回来了　试着在下个和弦之前哼出 F 下面的那个音'],
      [3, '是 E♮　同样的 F → E♮　在更轻的人声下面仍然清楚'],
      [6, '《Breathe》用 C♯ 撑起循环　《Any Colour》让吉他落到 B　这里把 E♮ 留给钢琴'],
    ],
  },
];

let elapsed = 0;
export const lessons = edits.map((e) => {
  const { barStartsMs, firstMeasure } = barMap[e.excerptId];
  const sourceInMs = barStartsMs[0];
  const at = (bar) => {
    const i = Math.floor(bar), f = bar - i;
    return barStartsMs[i] - sourceInMs + (f ? Math.round((barStartsMs[i + 1] - barStartsMs[i]) * f) : 0);
  };
  const durationMs = e.endBar === undefined ? 285000 - elapsed : at(e.endBar);
  elapsed += durationMs;
  const harmony = e.harmony.map(([bar, symbol, mode = 'dorian', label], i) => ({
    at: at(bar), end: e.harmony[i + 1] ? at(e.harmony[i + 1][0]) : durationMs, symbol, mode, label,
  }));
  const cues = e.cues.map(([bar, line1], i) => ({
    at: at(bar), end: e.cues[i + 1] ? at(e.cues[i + 1][0]) : durationMs, line1,
  }));
  const song = songs[e.song];
  return { id: e.id, song: e.song, title: song.name, file: song.file, subtitle: e.subtitle, excerptId: e.excerptId,
    sourceInMs, durationMs, barStartsMs, firstMeasure, harmony, cues, audioMode: 'external_audio', edition: '2023 Remaster' };
});

export const tuning = [64, 59, 55, 50, 45, 40];
export function speech() { return ''; }
export function exercise() { return { events: [], harmony: [], duration: 0 }; }
