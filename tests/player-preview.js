const host = document.querySelector('#video');
const append = host.appendChild.bind(host);
host.appendChild = (frame) => {
  frame.src = frame.src.replace('/tests/player.html', '/player.html');
  return append(frame);
};
const video = EnglishListeningTyping.createYouTubeVideo(host, 'RcGyVTAoXEU', 30);
const status = document.querySelector('#status');
video.onError = message => status.textContent = message;
video.onBlocked = () => status.textContent = '请点击播放器播放';
video.ready.then(() => {
  status.textContent = '播放器已就绪';
  setInterval(() => status.textContent = `时间 ${video.currentTime.toFixed(2)} / ${video.duration}，暂停 ${video.paused}，片段结束 ${video.ended}`, 100);
}).catch(error => status.textContent = error.message);
document.querySelector('#start').onclick = () => video.playSegment(30, 34);
document.querySelector('#pause').onclick = () => video.pause();
