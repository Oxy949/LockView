import { Helpers } from "./helpers.js";

export class Locks {
    pan = false;
    zoom = false;
    boundingBox = false;

    constructor(applyLocks) {
        this.applyLocks = applyLocks;
    }

    get() {
        return {
            pan: this.pan,
            zoom: this.zoom,
            boundingBox: this.boundingBox
        }
    }

    update(locks, options = {fromSocket:false, save: false}) {
        if (locks) {
            if (locks.pan !== undefined) this.pan = locks.pan;
            if (locks.zoom !== undefined) this.zoom = locks.zoom;
            if (locks.boundingBox !== undefined) {
                this.boundingBox = locks.boundingBox;
                if (this.boundingBox) canvas.pan(Helpers.getViewPosition());
            }
        }
        
        if (lockView.controlButtonVisible) {
            Helpers.setControlToolActive('panLock', this.pan);
            Helpers.setControlToolActive('zoomLock', this.zoom);
            Helpers.setControlToolActive('boundingBox', this.boundingBox);
        }

        if (!options.fromSocket) {
            lockView.socket.updateLocks({
                locks: this.get(),
                scene: canvas.scene.id
            });
        }
        else if (lockView.controlButtonVisible){
            Helpers.renderControls();
        }

        if (options.save && Helpers.getUserSetting('control')) {
            if (game.user.isGM) {
                canvas.scene.setFlag('LockView', 'locks', this.get());
            }
            else {
                lockView.socket.requestFlagSet({flag: 'locks', value: this.get(), scene: canvas.scene.id});
            }
        }
        
    }

    
}
