import assert from 'node:assert/strict';
import {parseLrc,parseTimestampedLyrics,lyricAtTime} from '../mot-goc-nho/lyrics-timing.js';

let count=0;
function check(name,run){run();count++;console.log(`PASS ${name}`);}
// Original test phrases; these are not the song's lyrics.
const data='\uFEFF[ti:Kiểm thử]\n[offset:150]\n[00:00.00]\n[00:05.25][00:15.250]Đêm yên.\n[00:10.50]Gió nhẹ.\n[00:19.00]\n[length:00:22.00]';
const timeline=parseLrc(data);
check('LRC metadata, BOM, repeated lines and sorting',()=>{
 assert.equal(timeline.metadata.ti,'Kiểm thử');
 assert.equal(timeline.offsetMs,150);
 assert.deepEqual(timeline.cues.map(c=>c.time),[0,5.25,10.5,15.25,19]);
 assert.equal(timeline.duration,22);
});
check('Intro and explicit instrumental cues remain empty',()=>{
 assert.equal(lyricAtTime(timeline,1).text,'');
 assert.equal(lyricAtTime(timeline,19).text,'');
 assert.equal(lyricAtTime(timeline,-1).text,'');
});
check('Offset signs shift actual audio selection consistently',()=>{
 assert.equal(lyricAtTime(timeline,5.05).text,'');
 assert.equal(lyricAtTime(timeline,5.05,{offsetMs:100}).text,'Đêm yên.');
 assert.equal(lyricAtTime(timeline,5.3,{offsetMs:-250}).text,'');
});
check('Seek forward, backward and loop select the current cue',()=>{
 assert.equal(lyricAtTime(timeline,16).text,'Đêm yên.');
 assert.equal(lyricAtTime(timeline,11).text,'Gió nhẹ.');
 assert.equal(lyricAtTime(timeline,0).text,'');
 assert.equal(lyricAtTime(timeline,6).index,1);
});
check('Timestamp fractions support tenths, hundredths and milliseconds',()=>{
 assert.deepEqual(parseLrc('[01:02.3]A\n[01:03.25]B\n[01:04.125]C').cues.map(c=>c.time),[62.3,63.25,64.125]);
});
check('Invalid seconds and untimestamped text never become cues',()=>{
 assert.equal(parseLrc('[00:61.00]Không hợp lệ\nKhông có mốc').hasLyrics,false);
 assert.equal(parseLrc('# Ghi chú\n[ar:Tác giả]').hasLyrics,false);
});
check('Identical timestamps use final entry including blank clear',()=>{
 const t=parseLrc('[00:01.00]A\n[00:01.00]\n[00:02.00]B');
 assert.equal(t.cues.length,2);
 assert.equal(lyricAtTime(t,1.5).text,'');
});
check('Vietnamese decomposed marks normalize without dropping spaces',()=>{
 assert.equal(parseLrc('[00:01.00]'+ 'Đêm yên.'.normalize('NFD')).cues[0].text,'Đêm yên.');
});
check('Explicit JSON ends clear vocals before following cue',()=>{
 const t=parseTimestampedLyrics({cues:[{time:2,end:4,text:'A'},{time:8,end:10,text:'B'}]});
 assert.equal(lyricAtTime(t,3).text,'A');
 assert.equal(lyricAtTime(t,5).text,'');
 assert.equal(lyricAtTime(t,9).text,'B');
});
check('Final cue expires at duration, end or max display limit',()=>{
 const t=parseLrc('[00:01.00]A');
 assert.equal(lyricAtTime(t,6,{maxDisplayMs:4000}).text,'');
 assert.equal(lyricAtTime(t,3,{mediaDuration:3}).text,'');
 assert.equal(lyricAtTime(t,2,{ended:true}).text,'');
});
check('Animation phase is a pure function of media position',()=>{
 const t=parseLrc('[00:02.00]A\n[00:07.00]');
 assert.equal(lyricAtTime(t,2.1).phase,'forming');
 assert.equal(lyricAtTime(t,4).phase,'stable');
 assert.equal(lyricAtTime(t,6.6).phase,'dissolving');
 const paused=lyricAtTime(t,6.6);
 assert.deepEqual(lyricAtTime(t,6.6),paused);
});
check('Preview never crosses a blank instrumental cue',()=>{
 assert.equal(lyricAtTime(timeline,17).nextText,'');
 assert.equal(lyricAtTime(timeline,7,{showNext:false}).nextText,'');
 assert.equal(lyricAtTime(timeline,6,{nextPreviewMs:1000}).nextText,'');
});
console.log(`${count} lyric timing checks passed.`);
