import { CompositeDisposable, Disposable } from "event-kit";
import * as THREE from "three";
import CommandRegistry from "../components/atom/CommandRegistry";
import { Viewport } from "../components/viewport/Viewport";
import { EditorSignals } from '../editor/EditorSignals';
import { DatabaseLike } from "../editor/GeometryDatabase";
import LayerManager from "../editor/LayerManager";
import MaterialDatabase from "../editor/MaterialDatabase";
import { PlaneSnap } from "../editor/snaps/Snap";
import { SnapManager } from "../editor/snaps/SnapManager";
import { CancellablePromise } from "../util/Cancellable";
import { Helper, Helpers } from "../util/Helpers";
import { GizmoMaterialDatabase } from "./GizmoMaterials";

/**
 * Gizmos are the graphical tools used to run commands, such as move/rotate/fillet, etc.
 * Generally, they have 1) a visible handle and 2) an invisible picker that's larger and easy to click.
 * They also might have a helper and a delta, which are visual feedback for interaction.
 * 
 * AbstractGizmo.execute() handles the basic state machine of hover/mousedown/mousemove/mouseup.
 * It also computes some useful data (e.g., how far the user has dragged) in 2d, 3d cartesian,
 * and polar screen space. By 3d screenspace, I mean mouse positions projected on to a 3d plane
 * facing the camera located at the position of the widget. Subclasses might also compute similar
 * data by implementing onPointerHover/onPointerDown/onPointerMove.
 * 
 * Note that these gizmos ALSO implement Blender-style modal interaction. For example,
 * when a user types "x" with the move gizmo active, it starts moving along the x axis.
 */

export interface GizmoView {
    handle: THREE.Object3D;
    picker: THREE.Object3D;
    helper?: GizmoHelper;
}

export interface EditorLike {
    db: DatabaseLike;
    helpers: Helpers;
    viewports: Viewport[];
    signals: EditorSignals;
    registry: CommandRegistry;
    gizmos: GizmoMaterialDatabase;
    materials: MaterialDatabase;
    snaps: SnapManager;
    layers: LayerManager;
}

export interface GizmoLike<CB> {
    execute(cb: CB, finishFast?: Mode): CancellablePromise<void>;
}

export enum Mode {
    None = 0 << 0,
    Persistent = 1 << 0,
    DisableSelection = 1 << 1,
};

export abstract class AbstractGizmo<CB> extends Helper {
    stateMachine?: GizmoStateMachine<CB>;
    trigger: GizmoTriggerStrategy<CB> = new BasicGizmoTriggerStrategy(this.title, this.editor);

    protected handle = new THREE.Group();
    readonly picker = new THREE.Group();
    readonly helper?: GizmoHelper;

    constructor(protected readonly title: string, protected readonly editor: EditorLike) {
        super();

        this.picker.visible = false; // The picker is only a mouse target; should never be rendered
        this.add(this.handle, this.picker);
    }

    onPointerEnter(intersector: Intersector) { }
    onPointerLeave(intersector: Intersector) { }
    onKeyPress(cb: CB, text: string) { }
    abstract onPointerMove(cb: CB, intersector: Intersector, info: MovementInfo): void;
    abstract onPointerDown(cb: CB, intersect: Intersector, info: MovementInfo): void;
    abstract onPointerUp(cb: CB, intersect: Intersector, info: MovementInfo): void;
    abstract onInterrupt(cb: CB): void;
    onDeactivate() { }
    onActivate() { }

    execute(cb: CB, mode: Mode = Mode.Persistent): CancellablePromise<void> {
        const disposables = new CompositeDisposable();
        if (this.parent === null) {
            this.editor.helpers.add(this);
            disposables.add(new Disposable(() => this.editor.helpers.remove(this)));
        }

        const stateMachine = new GizmoStateMachine(this, this.editor.signals, cb);
        this.stateMachine = stateMachine;
        disposables.add(new Disposable(() => this.stateMachine = undefined));

        return new CancellablePromise<void>((resolve, reject) => {
            // Aggregate the commands, like 'x' for :move:x
            const registry = this.editor.registry;
            const commands: [string, () => void][] = [];
            const commandNames: string[] = [];
            for (const picker of this.picker.children) {
                if (picker.userData.command == null) continue;
                const [name, fn] = picker.userData.command as [string, () => void];
                commands.push([name, fn]);
                commandNames.push(name);
            }
            this.editor.signals.keybindingsRegistered.dispatch(commandNames);
            disposables.add(new Disposable(() => this.editor.signals.keybindingsCleared.dispatch(commandNames)));

            for (const viewport of this.editor.viewports) {
                const { renderer: { domElement } } = viewport;

                if ((mode & Mode.DisableSelection) === Mode.DisableSelection) {
                    viewport.selector.enabled = false;
                }

                // First, register any keyboard commands for each viewport, like 'x' for :move:x
                for (const [name, fn] of commands) {
                    const disp = registry.addOne(domElement, name, () => {
                        // If a keyboard command is invoked immediately after the gizmo appears, we will
                        // not have received any pointer info from pointermove/hover. Since we need a "start"
                        // position for many calculations, use the "lastPointerEvent" which is ALMOST always available.
                        const lastEvent = viewport.lastPointerEvent ?? new PointerEvent("pointermove");
                        stateMachine.update(viewport, lastEvent);
                        stateMachine.command(fn, () => {
                            domElement.ownerDocument.body.setAttribute("gizmo", this.title);
                            viewport.disableControls();
                            return addEventHandlers();
                        });
                    });
                    disposables.add(disp);
                }

                // Add handlers when triggered, for example, on pointerdown
                const addEventHandlers = () => {
                    domElement.ownerDocument.addEventListener('pointermove', onPointerMove);
                    domElement.ownerDocument.addEventListener('pointerup', onPointerUp);
                    return new Disposable(() => {
                        domElement.ownerDocument.removeEventListener('pointerup', onPointerUp);
                        domElement.ownerDocument.removeEventListener('pointermove', onPointerMove);
                    });
                }

                const onPointerMove = (event: PointerEvent) => {
                    stateMachine.update(viewport, event);
                    stateMachine.pointerMove();
                }

                const onPointerUp = (event: PointerEvent) => {
                    stateMachine.update(viewport, event);
                    stateMachine.pointerUp(() => {
                        if ((mode & Mode.Persistent) !== Mode.Persistent) {
                            dispose();
                            resolve();
                        }
                        domElement.ownerDocument.body.removeAttribute('gizmo');
                        viewport.enableControls();
                    });
                }

                const trigger = this.trigger.register(this, viewport, addEventHandlers);
                disposables.add(new Disposable(() => {
                    viewport.enableControls();
                    trigger.dispose();
                    domElement.ownerDocument.removeEventListener('pointerup', onPointerUp);
                    domElement.ownerDocument.removeEventListener('pointermove', onPointerMove);
                }));
                this.editor.signals.gizmoChanged.dispatch();
            }
            const dispose = () => {
                stateMachine.finish();
                disposables.dispose();
                this.editor.signals.gizmoChanged.dispatch();
            }
            return { dispose, finish: resolve };
        });
    }

    static getPointer(domElement: HTMLElement, event: MouseEvent): Pointer {
        const rect = domElement.getBoundingClientRect();

        return {
            x: (event.clientX - rect.left) / rect.width * 2 - 1,
            y: - (event.clientY - rect.top) / rect.height * 2 + 1,
            button: event.button,
            event
        };
    }
}

export interface GizmoTriggerStrategy<T> {
    register(gizmo: AbstractGizmo<T>, viewport: Viewport, addEventHandlers: () => Disposable): Disposable;
}

export class BasicGizmoTriggerStrategy<T> implements GizmoTriggerStrategy<T> {
    constructor(private readonly title: string, private readonly editor: EditorLike) { }

    register(gizmo: AbstractGizmo<T>, viewport: Viewport, addEventHandlers: () => Disposable): Disposable {
        const stateMachine = gizmo.stateMachine!;
        const { renderer: { domElement } } = viewport;

        const onPointerDown = (event: PointerEvent) => {
            stateMachine.update(viewport, event);
            stateMachine.pointerDown(() => {
                event.preventDefault();
                event.stopPropagation();
                event.stopImmediatePropagation();

                domElement.ownerDocument.body.setAttribute("gizmo", this.title);
                viewport.disableControls();
                return addEventHandlers();
            });
        }

        const onKeyPress = (event: KeyboardEvent) => {
            stateMachine.keyPress(event.key);
        }

        const onPointerHover = (event: PointerEvent) => {
            stateMachine.update(viewport, event);
            stateMachine.pointerHover();
        }

        // NOTE: Gizmos take priority over viewport controls; capture:true it's received first here.
        domElement.addEventListener('pointerdown', onPointerDown, { capture: true });
        domElement.addEventListener('pointermove', onPointerHover);
        domElement.ownerDocument.addEventListener('keypress', onKeyPress);
        return new Disposable(() => {
            domElement.removeEventListener('pointerdown', onPointerDown, { capture: true });
            domElement.removeEventListener('pointermove', onPointerHover);
            domElement.ownerDocument.removeEventListener('keypress', onKeyPress);
            domElement.ownerDocument.body.removeAttribute('gizmo');
        });
    }
}

export interface Pointer {
    x: number; y: number, button: number, event: MouseEvent
}

export type Intersector = (...objects: THREE.Object3D[]) => THREE.Intersection | undefined

export interface MovementInfo {
    // These are the mouse down and mouse move positions in screenspace
    pointStart2d: THREE.Vector2;
    pointEnd2d: THREE.Vector2;

    // These are the mouse positions projected on to a plane facing the camera
    // but located at the gizmos position
    pointStart3d: THREE.Vector3;
    pointEnd3d: THREE.Vector3;

    // This is the angle change (polar coordinates) in screenspace
    endRadius: THREE.Vector2;
    angle: number;
    center2d: THREE.Vector2;

    constructionPlane: PlaneSnap;

    eye: THREE.Vector3;

    viewport: Viewport;

    pointer: Pointer;
}

// This class handles computing some useful data (like click start and click end) of the
// gizmo user interaction. It deals with the hover->click->drag->unclick case (the traditional
// gizmo interactions) as well as the keyboardCommand->move->click->unclick case (blender modal-style).
type State = { tag: 'none' } | { tag: 'hover' } | { tag: 'dragging', clearEventHandlers: Disposable } | { tag: 'command', clearEventHandlers: Disposable, text: string }

export class GizmoStateMachine<T> implements MovementInfo {
    // NOTE: isActive and isEnabled differ only slightly. When !isEnabled, the gizmo is COMPLETELY disabled.
    // However, when !isActive, the gizmo will not respond to mouse input, but will respond to keyboard input; ie, the keyboard will interrupt other active gizmos and activate this one.
    private _isActive = true;
    get isActive() { return this._isActive }
    set isActive(isActive: boolean) {
        this._isActive = isActive;
        if (isActive) this.gizmo.onActivate();
        else this.gizmo.onDeactivate();
    }
    isEnabled = true;

    state: State = { tag: 'none' };
    pointer!: Pointer;

    private readonly cameraPlane = new THREE.Mesh(new THREE.PlaneGeometry(100_000, 100_000, 2, 2), new THREE.MeshBasicMaterial());
    constructionPlane!: PlaneSnap;
    eye = new THREE.Vector3();
    pointStart2d = new THREE.Vector2();
    pointEnd2d = new THREE.Vector2();
    pointStart3d = new THREE.Vector3();
    pointEnd3d = new THREE.Vector3();
    center2d = new THREE.Vector2()
    endRadius = new THREE.Vector2();
    angle = 0;

    private readonly raycaster = new THREE.Raycaster();

    constructor(
        private readonly gizmo: AbstractGizmo<T>,
        private readonly signals: EditorSignals,
        private readonly cb: T,
    ) { }

    private _viewport!: Viewport;
    get viewport() { return this._viewport }

    private camera!: THREE.Camera;
    update(viewport: Viewport, event: MouseEvent) {
        const pointer = AbstractGizmo.getPointer(viewport.domElement, event);
        const camera = viewport.camera;
        this._viewport = viewport;
        this.camera = camera;
        this.eye.copy(camera.position).sub(this.gizmo.position).normalize();
        this.gizmo.update(camera);
        this.cameraPlane.position.copy(this.gizmo.position);
        this.cameraPlane.quaternion.copy(camera.quaternion);
        this.cameraPlane.updateMatrixWorld();
        this.constructionPlane = viewport.constructionPlane;
        this.raycaster.setFromCamera(pointer, camera);
        this.pointer = pointer;
    }

    private intersector: Intersector = (...obj) => GizmoStateMachine.intersectObjectWithRay(obj, this.raycaster);

    private worldPosition = new THREE.Vector3();
    private begin() {
        const intersection = this.intersector(this.cameraPlane);
        if (!intersection) throw "corrupt intersection query";

        switch (this.state.tag) {
            case 'none':
            case 'hover':
                const { worldPosition } = this;
                const center3d = this.gizmo.getWorldPosition(worldPosition).project(this.camera);
                this.center2d.set(center3d.x, center3d.y);
                this.pointStart3d.copy(intersection.point);
                this.pointStart2d.set(this.pointer.x, this.pointer.y);
                this.gizmo.onPointerDown(this.cb, this.intersector, this);
                this.gizmo.helper?.onStart(this.viewport.domElement, this.center2d);
                break;
            case 'command':
                this.pointerMove();
                break;
            default: throw new Error("invalid state");
        }
        this.signals.gizmoChanged.dispatch();
    }

    command(fn: (cb?: T) => void, start: () => Disposable): void {
        if (!this.isEnabled) return;

        switch (this.state.tag) {
            case 'none':
            case 'hover':
                const clearEventHandlers = start();
                if (fn(this.cb) === undefined) {
                    this.gizmo.update(this.camera);
                    this.begin();
                    this.state = { tag: 'command', clearEventHandlers, text: "" };
                    this.gizmo.dispatchEvent({ type: 'start' });
                } else {
                    clearEventHandlers.dispose();
                }
            default: break;
        }
    }

    pointerDown(start: () => Disposable): void {
        if (!this.isActive) return;
        if (!this.isEnabled) return;

        switch (this.state.tag) {
            case 'hover':
                if (this.pointer.button !== 0) return;

                this.begin();
                const clearEventHandlers = start();
                this.state = { tag: 'dragging', clearEventHandlers };
                this.gizmo.dispatchEvent({ type: 'start' });
                break;
            default: break;
        }
    }

    pointerMove(): void {
        if (!this.isActive) return;
        if (!this.isEnabled) return;

        switch (this.state.tag) {
            case 'dragging':
                if (this.pointer.button !== -1) return;
            case 'command':
                this.pointEnd2d.set(this.pointer.x, this.pointer.y);
                const intersection = this.intersector(this.cameraPlane,);
                if (!intersection) throw new Error("corrupt intersection query");
                this.pointEnd3d.copy(intersection.point);
                this.endRadius.copy(this.pointEnd2d).sub(this.center2d).normalize();
                const startRadius = this.pointStart2d.clone().sub(this.center2d);
                this.angle = Math.atan2(this.endRadius.y, this.endRadius.x) - Math.atan2(startRadius.y, startRadius.x);

                this.gizmo.helper?.onMove(this.pointEnd2d);
                this.gizmo.onPointerMove(this.cb, this.intersector, this);

                this.signals.gizmoChanged.dispatch();
                break;
            default: throw new Error('invalid state: ' + this.state.tag);
        }
    }

    pointerUp(finish: () => void): void {
        if (!this.isActive) return;
        if (!this.isEnabled) return;

        switch (this.state.tag) {
            case 'dragging':
            case 'command':
                if (this.pointer.button !== 0) return;

                this.state.clearEventHandlers.dispose();
                this.signals.gizmoChanged.dispatch();
                this.state = { tag: 'none' };
                this.gizmo.dispatchEvent({ type: 'end' });
                this.gizmo.onPointerUp(this.cb, this.intersector, this);
                this.gizmo.helper?.onEnd();

                finish();
                break;
            default: break;
        }
    }

    pointerHover(): void {
        if (!this.isActive) return;
        if (!this.isEnabled) return;

        switch (this.state.tag) {
            case 'none': {
                const intersect = this.intersector(this.gizmo.picker);
                if (intersect !== undefined) {
                    this.gizmo.onPointerEnter(this.intersector);
                    this.state = { tag: 'hover' }
                    // this.viewport.disableControls();
                    this.signals.gizmoChanged.dispatch();
                }
                break;
            }
            case 'hover': {
                const intersect = this.intersector(this.gizmo.picker);
                if (intersect === undefined) {
                    this.gizmo.onPointerLeave(this.intersector);
                    this.state = { tag: 'none' }
                    // this.viewport.enableControls();
                    this.signals.gizmoChanged.dispatch();
                }
                break;
            }
            default: break;
        }
    }

    keyPress(key: string): void {
        if (!this.isActive) return;
        if (!this.isEnabled) return;

        switch (this.state.tag) {
            case 'command':
                this.state.text += key;
                this.gizmo.onKeyPress(this.cb, this.state.text);
                this.signals.gizmoChanged.dispatch();
                break;
            default: break;
        }
    }

    interrupt() {
        switch (this.state.tag) {
            case 'command':
            case 'dragging':
                this.state.clearEventHandlers.dispose();
                this.gizmo.dispatchEvent({ type: 'interrupt' });
                this.gizmo.onInterrupt(this.cb);
                this.gizmo.helper?.onEnd();
            case 'hover':
                this.state = { tag: 'none' };
            default: break;
        }
    }

    finish() {
        this.gizmo.helper?.onEnd();
    }

    static intersectObjectWithRay(objects: THREE.Object3D[], raycaster: THREE.Raycaster): THREE.Intersection | undefined {
        const allIntersections = raycaster.intersectObjects(objects, true);
        for (var i = 0; i < allIntersections.length; i++) {
            return allIntersections[i];
        }
    }
}

export interface GizmoHelper {
    onStart(parentElement: HTMLElement, position: THREE.Vector2): void;
    onMove(position: THREE.Vector2): void;
    onEnd(): void;
}
