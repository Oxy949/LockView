import { moduleName } from "../../lockview.js";
import { Helpers } from "../helpers.js";
import { libWrapper } from "./shim.js";

export function registerLibWrapperFunctions() {
    addLockOverrides();
    addStaticUserOverrides();
    addBoundingBoxOverrides();

    //Wait for "ready" hook before configuring scene config overrides, to give systems the time to register their own scene config
    Hooks.once("ready", () => addSceneConfigOverrides())
}

/**
 * Overrides the default canvas pan
 */
function addLockOverrides() {
    libWrapper.register(moduleName, "foundry.canvas.Canvas.prototype.pan", function (wrapped, ...args) {
        const locks = lockView.locks;
       
        /* For users with 'Enable' */
        if (locks.applyLocks) {

            if (locks.boundingBox) {
                args[0] = boundingBoxHandler(args[0]);
                if (args[0] === false) return;
            }

            /* If pan and zoom are locked, prevent default pan action and make sure autoscaling is reset */
            if (locks.pan && locks.zoom) {
                lockView.sceneHandler.setAutoscale();
                return;
            }

            /* If pan lock is enabled and the scale has not changed, prevent default pan action. */
            if (locks.pan && !args[0].scale) return;
            /* Otherwise, if pan lock is enabled, make sure x and y coordinates are undefined. */
            else if (locks.pan) {
                args[0].x = undefined;
                args[0].y = undefined;
            }

            /* If zoom lock is enabled and the position has not changed, prevent default pan action */
            if (locks.zoom && !args[0].x && !args[0].y) return;
            /* Otherwise, if zoom lock is enabled, make sure the scale is undefined. */
            else if (locks.zoom) {
                args[0].scale = undefined;
            }
        }

        /* Emit the current view to users with 'Control' enabled */
        lockView.viewbox.emit();

        /* 
            If viewbox editing is enabled, prevent default canvas pan and send scale changes to users to change their view. 
            Only scale is set this way, position is handled by the Viewbox class.
        */
        if (lockView.viewbox.editEnabled && game.settings.get('LockView', 'mouserViewboxControl')) {
            wrapped();
            if (args[0].scale && lockView.viewbox.getActiveViewbox()) {
                const viewPosition = Helpers.getViewPosition();
                lockView.socket.setView({
                    type: 'relative',
                    userId: lockView.viewbox.getActiveViewbox(),
                    position: { scale: args[0].scale/viewPosition.scale }
                })
            }
            return;
        }

        /* If zooming and panning is not prevented, handle the default pan. */
        return wrapped(...args);
    }, "MIXED");


    libWrapper.register(moduleName, "foundry.canvas.Canvas.prototype.initializeCanvasPosition", function (wrapped) {
        /* For users with 'Enable' */
        if (lockView.locks.applyLocks) {
            lockView.locks.applyLocks = false;
            wrapped();
            lockView.locks.applyLocks = true;
        }
        else return wrapped();
    }, "MIXED");

    libWrapper.register(moduleName, "foundry.canvas.layers.ControlsLayer.prototype.handlePing", function (wrapped, ...args) {
        const panLockMode = game.settings.get(moduleName, 'pingPan');
        
        /* For users with 'Enable' */
        if (args[2]?.pull && panLockMode !== 'block' && lockView.Helpers.getUserSetting('control', args[0].id) && lockView.locks.applyLocks) {
            const locks = structuredClone(lockView.locks);
            if (panLockMode === 'panOnly' || panLockMode === 'any') lockView.locks.pan = false;
            if (panLockMode === 'zoomOnly' || panLockMode === 'any') lockView.locks.zoom = false;

            //Normally it takes a while for the wrapped function to be resolved, which means that there is some time that a users can pan or zoom
            //To prevent this, reapply locks after CONFIG.Canvas.pings.pullSpeed + 100ms
            setTimeout(() => {
                lockView.locks.pan = locks.pan;
                lockView.locks.zoom = locks.zoom;
            }, CONFIG.Canvas.pings.pullSpeed+100)

            return wrapped(...args);
        }

        return wrapped(...args);
    }, "WRAPPER");
}

/**
 * Overrides to add Lock View settings to the scene configuration
 */
function addSceneConfigOverrides() {
    const sceneConfig = getSceneConfigClass();
    if (sceneConfig.__lockViewInjected) return;
    sceneConfig.__lockViewInjected = true;

    const parts = sceneConfig.PARTS;
    if (!parts.lockView) {
        const footer = parts.footer;
        delete parts.footer;
        parts.lockView = { template: 'modules/LockView/templates/sceneConfig.hbs', scrollable: [""] };
        if (footer) parts.footer = footer;
    }

    if (!sceneConfig.TABS.sheet.tabs.some(t => t.id === 'lockView')) {
        sceneConfig.TABS.sheet.tabs.push({
            id: 'lockView',
            icon: 'fas fa-tv',
            label: 'Lock View'
        })
    }

    wrapSceneConfigPrepareContext(sceneConfig);
    wrapSceneConfigRender(sceneConfig);
}

function getSceneConfigClass() {
    const sceneConfig = foundry.applications.sheets.SceneConfig;
    const documentSheetConfig = foundry.applications.apps?.DocumentSheetConfig;
    const defaultClass = documentSheetConfig?.getSheetClassesForSubType?.("Scene")?.defaultClass;
    const sheetClasses = CONFIG.Scene?.sheetClasses ?? {};
    const configuredClass = Object.values(sheetClasses)
        .flatMap(sheetGroup => Object.entries(sheetGroup))
        .find(([id, sheet]) => id === defaultClass || sheet?.id === defaultClass)?.[1]?.cls;

    return configuredClass?.prototype instanceof sceneConfig ? configuredClass : sceneConfig;
}

function wrapSceneConfigPrepareContext(sceneConfig) {
    const prepareContext = sceneConfig.prototype._prepareContext;
    sceneConfig.prototype._prepareContext = async function (...args) {
        const context = await prepareContext.call(this, ...args);
        const document = context.document ?? this.document;
        if (!document) return context;

        Object.assign(context, {
            sceneId: document.id,
            ...lockView.sceneHandler.getSceneConfig(document.flags.LockView)
        });
        return context;
    }
}

function wrapSceneConfigRender(sceneConfig) {
    const onRender = sceneConfig.prototype._onRender;
    sceneConfig.prototype._onRender = function (...args) {
        const result = onRender.call(this, ...args);
        addSceneConfigListeners.call(this, args[0]);
        return result;
    }
}

function addSceneConfigListeners(context) {
    const scene = context?.document ?? this.document;
    this.element.querySelector('button[name="openInitialViewConfig"]')?.addEventListener('click', () => {
        lockView.apps.initialViewConfig.setScene(scene).render(true);
    });

    //Configure expandable sections
    for (let elmnt of this.element.querySelectorAll('.lockview-expandable')) {
        const expandElements = this.element.querySelectorAll(`div[name="${elmnt.dataset.expand}"]`)
        elmnt.addEventListener('click', () => {
            for (let expandElmnt of expandElements)
                expandElmnt.classList.toggle('lockview-collapsed')
            const icon = elmnt.firstElementChild;
            if (icon?.classList.contains('fa-caret-right'))
                icon.classList.replace('fa-caret-right', 'fa-caret-down');
            else
                icon?.classList.replace('fa-caret-down', 'fa-caret-right');
        })
    }

    //Handle 'expand all' button
    this.element.querySelector('button[name="lockview-expandAll"]')?.addEventListener('click', () => {
        const expandElements = this.element.querySelectorAll(`.lockview-expandable`);
        for (let elmnt of expandElements) {
            const icon = elmnt.firstElementChild;
            if (icon?.classList.contains('fa-caret-right')) {
                icon.classList.replace('fa-caret-right', 'fa-caret-down');
                for (let expandElmnt of this.element.querySelectorAll(`div[name="${elmnt.dataset.expand}"]`))
                    expandElmnt.classList.toggle('lockview-collapsed')
            }
        }
    })

    //Handle 'collapse all' button
    this.element.querySelector('button[name="lockview-collapseAll"]')?.addEventListener('click', () => {
        const expandElements = this.element.querySelectorAll(`.lockview-expandable`);
        for (let elmnt of expandElements) {
            const icon = elmnt.firstElementChild;
            if (icon?.classList.contains('fa-caret-down')) {
                icon.classList.replace('fa-caret-down', 'fa-caret-right');
                for (let expandElmnt of this.element.querySelectorAll(`div[name="${elmnt.dataset.expand}"]`))
                    expandElmnt.classList.toggle('lockview-collapsed')
            }
        }
    })

    //Handle 'Scene Configurator' button
    this.element.querySelector('button[name="lockView-openSceneConfigurator"]')?.addEventListener('click', () => {
        lockView.apps.sceneConfigurator.render(true);
    })

    //Add 'Lock View Help' button to header
    const controlsDropdown = this.element.querySelector(".controls-dropdown");
    if (!controlsDropdown || controlsDropdown.querySelector('[data-lockview-help]')) return;

    const headerElmnt = document.createElement('li');
    controlsDropdown.appendChild(headerElmnt);
    headerElmnt.setAttribute('class', 'header-control');
    headerElmnt.dataset.lockviewHelp = "";

    headerElmnt.innerHTML = `
    <button class="control" type="button">
        <i class="fas fa-tv"></i>
        <span class="control-label">${Helpers.localize("LockViewHelp", "SceneConfig")}</span>
    </button>
    `;

    headerElmnt.addEventListener('click', () => window.open(Helpers.getDocumentationUrl('sceneConfig/sceneConfig')))
}

/**
 * Overrides related to static users: prevent default scene viewing, add 'Pull Static Users' option to the scene navigation.
 */
function addStaticUserOverrides() {
    let firstScene = true;
    /**
     * Prevent scene view for static users unless scene.view({forceView:true})
     */
    libWrapper.register(moduleName, "foundry.documents.Scene.prototype.view", function (wrapped, ...args) {
        if (!firstScene && Helpers.getUserSetting('static') && !args[0]?.forceView) return;
        if (args[0]?.forceView) {
            args[0] = {...args[0]};
            delete args[0].forceView;
        }
        setTimeout(()=>{firstScene = false},1000);
        return wrapped(...args);
    }, "MIXED");

    /**
     * Add option to scene navigation to pull static users to that scene
     */
    libWrapper.register(moduleName, "foundry.applications.ui.SceneNavigation.prototype._getContextMenuOptions", function (wrapped, ...args) {
        let menuOptions = wrapped(...args);
        menuOptions.push({
            name: Helpers.localize("SceneNavigation.PullStaticUsers"),
            icon: '<i class="fa-solid fa-user-lock"></i>',
            condition: li => game.user.isGM && game.settings.get(moduleName, 'userSettings').find(u => u.static) !== undefined,
            callback: li => lockView.socket.pullStaticUsers(li.dataset.sceneId)
        })
        return menuOptions;
    }, "WRAPPER");
}

function addBoundingBoxOverrides() {
    /**
     * Add Lock View options to drawing config
     */
    let drawingConfig = foundry.applications.sheets.DrawingConfig
    if (!drawingConfig.PARTS.lockView) {
        drawingConfig.PARTS.lockView = { template: 'modules/LockView/templates/drawingConfig.hbs', scrollable: [""]};
        drawingConfig.PARTS = Helpers.moveObjectElement('footer', 'lockView', foundry.applications.sheets.DrawingConfig.PARTS);
    }
    if (!foundry.applications.sheets.DrawingConfig.TABS.sheet.tabs.some(t => t.id === 'lockView')) {
        foundry.applications.sheets.DrawingConfig.TABS.sheet.tabs.push({
            id: 'lockView',
            icon: 'fas fa-tv',
            label: 'Lock View'
        })
    }

    /**
     * Hide lock view options on non-rectangle shapes
     */
    libWrapper.register(moduleName, "foundry.applications.sheets.DrawingConfig.prototype._onRender", function (...args) {
        const context = args[0];
        if (!isRectangleDrawing(context.document))
            this.element.querySelector('a[data-tab="lockView"]')?.style.setProperty('display', 'none');
    }, "LISTENER");

    /**
     * Add Lock View settings to drawing configuration
     */
    libWrapper.register(moduleName, "foundry.applications.sheets.DrawingConfig.prototype._preparePartContext", async function (wrapped, ...args) {
        if (args[0] === 'lockView') {
            let context = args[1];
            let flags = context.document.flags.LockView;

            return {
                tab: context.tabs[args[0]],
                boundingBox: flags?.boundingBox || 'disabled',
                boundingBoxOptions: [
                    { value: 'disabled', label: Helpers.localize("Disabled", "DrawingConfig") },
                    { value: 'owned', label: Helpers.localize("OwnedTokens", "DrawingConfig") },
                    { value: 'always', label: Helpers.localize("Always", "DrawingConfig") }
                ]
            };
        }
        else
            return wrapped(...args);
    }, "MIXED");

    /**
     * Overrides submit handling of the drawing configuration to handle Lock View settings
     */
    libWrapper.register(moduleName, "foundry.applications.sheets.DrawingConfig.prototype._processSubmitData", async function (wrapped, ...args) {
        const submitData = getExpandedSubmitData(args[1], args[2]);
        const lockViewData = submitData.lockview;
        removeLockViewSubmitData(args[2]);

        if (lockViewData && this.document?.id) {
            await this.document.update({
                flags: {
                    LockView: lockViewData
                }
            });

            if (lockViewData.boundingBox) canvas.pan(Helpers.getViewPosition());
        }
        
        return wrapped(...args);
    }, "WRAPPER");
}

export function boundingBoxHandler(coords) {
    let drawings = canvas.scene.drawings.filter(d => isRectangleDrawing(d) && (d.flags?.LockView?.boundingBox === 'always' || d.flags?.LockView?.boundingBox === 'owned'));

    const currentPosition = Helpers.getViewPosition();
    const target = foundry.utils.mergeObject(currentPosition, coords)
    const sidebarWidth = canvas.scene.getFlag(moduleName, 'sidebar')?.exclude ? Helpers.getSidebarWidth() : 0;
    const scaledSidebarWidth = sidebarWidth/target.scale;
    const windowHeight = window.innerHeight;
    const windowWidth = window.innerWidth;
    const width = windowWidth/target.scale;
    const height = windowHeight/target.scale;

    const targetCorners = {
        topLeft: { x: target.x - width/2, y: target.y - height/2 },
        topRight: { x: target.x + width/2 - scaledSidebarWidth, y: target.y - height/2 },
        bottomLeft: { x: target.x - width/2, y: target.y + height/2 },
        bottomRight: { x: target.x + width/2 - scaledSidebarWidth, y: target.y + height/2 }
    }
    
    const containsPoint = (drawing, point) => {
        if (point.x < drawing.x) return false;
        if (point.x > drawing.x + drawing.shape.width) return false;
        if (point.y < drawing.y) return false;
        if (point.y > drawing.y + drawing.shape.height) return false;
        return true;
    }

    let applicableDrawings = [];

    //Check all drawings
    for (let drawing of drawings) {
        const mode = drawing.flags?.LockView?.boundingBox || 'always';

        let isInside = true;
        //Check if all points of the view are within the drawing
        for (let point of Object.values(targetCorners)) {
            if (!containsPoint(drawing, point)) {
                isInside = false;
                break;
            }
        }

        //If within drawing, continue
        if (isInside) {
            applicableDrawings.push({ mode, drawing, isInside: true });
            continue;
        }

        //Check if an owned token is within the drawing
        let tokens = [];
        if (mode === 'owned') {
            let tokenInDrawing = false;
            for (let token of canvas.tokens.ownedTokens) {
                const point = {x: token.document.x, y: token.document.y}
                if (containsPoint(drawing, point)) {
                    tokenInDrawing = true;
                    tokens.push(token);
                }
            }
            if (!tokenInDrawing) continue;
        }

        applicableDrawings.push({ mode, drawing, isInside: false, tokens });
    }

    let boundingBox;

    if (applicableDrawings.length === 0) {
        const dimensions = canvas.scene.dimensions;
        boundingBox = {
            x: dimensions.sceneX,
            y: dimensions.sceneY,
            shape: {
                width: dimensions.sceneWidth,
                height: dimensions.sceneHeight
            }
        }
    }

    const ownedDrawings = applicableDrawings.filter(d => d.mode === "owned");
    const alwaysDrawings = applicableDrawings.filter(d => d.mode === "always");
    if (ownedDrawings.length === 1) boundingBox = ownedDrawings[0].drawing;
    else if (ownedDrawings.length > 1) boundingBox = getCombinedDrawingSize(ownedDrawings);
    else if (alwaysDrawings.length === 1) boundingBox = alwaysDrawings[0].drawing;
    else if (alwaysDrawings.length > 1) boundingBox = getCombinedDrawingSize(alwaysDrawings);

    if (boundingBox) {
        //Check if the view is wider than the drawing. If so, set the scale and center on drawing
        const drawingWidthScale = windowWidth/boundingBox.shape.width;
        const drawingHeightScale = windowHeight/boundingBox.shape.height;
        const drawingScale = Math.max(drawingWidthScale, drawingHeightScale);
        if (drawingScale > target.scale) {
            return {
                x: boundingBox.x + boundingBox.shape.width/2,
                y: boundingBox.y + boundingBox.shape.height/2,
                scale: drawingScale
            }
        }

        //Check if view is within bounding box
        if (targetCorners.topLeft.x < boundingBox.x) coords.x = boundingBox.x + width/2;
        else if (targetCorners.topRight.x > boundingBox.x + boundingBox.shape.width) coords.x = boundingBox.x + boundingBox.shape.width - width/2 + scaledSidebarWidth;
        if (targetCorners.topLeft.y < boundingBox.y) coords.y = boundingBox.y + height/2;
        else if (targetCorners.bottomLeft.y > boundingBox.y + boundingBox.shape.height) coords.y = boundingBox.y + boundingBox.shape.height - height/2;
    }

    return coords;
}

Hooks.on('refreshToken', () => {
    if (lockView.locks.boundingBox)
        canvas.pan(Helpers.getViewPosition());
})

function getCombinedDrawingSize(drawings) {
    let top = 9999999;
    let bottom = 0;
    let left = 9999999;
    let right = 0;
    drawings.forEach(d => {
        const {x, y} = d.drawing;
        const {width, height} = d.drawing.shape;
        top = Math.min(top, y);
        bottom = Math.max(bottom, y+height);
        left = Math.min(left, x);
        right = Math.max(right, x+width);
        
    })

    const width = right - left;
    const height = bottom - top;
    return {
        x: left,
        y: top,
        shape: {
            width,
            height
        }
    }
}

function getExpandedSubmitData(form, submitData) {
    const data = submitData ?? new foundry.applications.ux.FormDataExtended(form).object;
    return foundry.utils.expandObject(data);
}

function removeLockViewSubmitData(submitData) {
    if (!submitData) return;
    delete submitData.lockview;
    for (const key of Object.keys(submitData)) {
        if (key.startsWith('lockview.')) delete submitData[key];
    }
}

function isRectangleDrawing(drawing) {
    const rectangleType = foundry.canvas?.placeables?.Drawing?.SHAPE_TYPES?.RECTANGLE ?? 'r';
    return drawing?.shape?.type === rectangleType || drawing?.shape?.type === 'r';
}
