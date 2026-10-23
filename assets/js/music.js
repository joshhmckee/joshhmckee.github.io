/**
 * The mixtapes play through YouTube's embedded player. Its script only loads when the first tape
 * goes in, and the player sits in the "now playing" card, which stays on screen while it plays.
 */
let api = null;
function loadApi() {
  if (api) return api;
  api = new Promise((resolve, reject) => {
    if (window.YT && window.YT.Player) return resolve(window.YT);
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      if (prev) prev();
      resolve(window.YT);
    };
    const s = document.createElement('script');
    s.src = 'https://www.youtube.com/iframe_api';
    s.async = true;
    s.onerror = () => {
      api = null;
      reject(new Error('YouTube player unavailable'));
    };
    document.head.appendChild(s);
  });
  return api;
}

export class Jukebox {
  /** mount: element the player iframe replaces. onEnd: called when a song finishes or fails to play. */
  constructor(mount, { onEnd = () => {} } = {}) {
    this.mount = mount;
    this.onEnd = onEnd;
    this.player = null;
    this.song = null;
  }

  async play(song) {
    this.song = song;
    const YT = await loadApi();
    if (this.song !== song) return; // another tape went in while the script loaded
    if (this.player) {
      this.player.loadVideoById(song.youtube);
      return;
    }
    await new Promise((resolve) => {
      this.player = new YT.Player(this.mount, {
        width: 320,
        height: 200,
        videoId: song.youtube,
        playerVars: { autoplay: 1, playsinline: 1, rel: 0 },
        events: {
          onReady: (e) => {
            e.target.playVideo();
            resolve();
          },
          onStateChange: (e) => e.data === YT.PlayerState.ENDED && this.onEnd(this.song),
          onError: () => this.onEnd(this.song),
        },
      });
    });
  }

  stop() {
    this.song = null;
    if (this.player && this.player.stopVideo) this.player.stopVideo();
  }
}
