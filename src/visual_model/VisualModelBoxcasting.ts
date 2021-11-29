import * as THREE from "three";
import { Boxcastable, Boxcaster, IntersectionType } from "../selection/Boxcaster";
import { Curve3D, CurveEdge, CurveGroup, CurveSegment, Face, FaceGroup, PlaneInstance, Region, Solid, SpaceInstance } from './VisualModel';

declare module './VisualModel' {
    interface Item extends Boxcastable { }
    interface FaceGroup extends Boxcastable { }
    interface CurveGroup<T> extends Boxcastable { }
    interface CurveEdge extends Boxcastable { }
    interface Face extends Boxcastable { }
    interface Curve3D extends Boxcastable { }
    interface CurveSegment extends Boxcastable { }
    interface Region extends Boxcastable { }
}

Solids: {
    Solid.prototype.boxcast = function (type: IntersectionType, boxcaster: Boxcaster, selects: Boxcastable[]) {
        const low = this.lod.low; // Lowest detail
        const edges = low.edges;
        const faces = low.faces
        faces.boxcast(type, boxcaster, selects);
        edges.boxcast(type, boxcaster, selects);
        return selects;
    }

    Solid.prototype.intersectsBounds = function (boxcaster: Boxcaster) {
        const low = this.lod.low; // Lowest detail
        const edges = low.edges;
        const faces = low.faces;
        return faces.intersectsBounds(boxcaster);
    }

    FaceGroup.prototype.boxcast = function (type: IntersectionType, boxcaster: Boxcaster, selects: Boxcastable[]) {
        if (type == 'contained') {
            for (const face of this) {
                selects.push(face);
            }
        } else if (type == 'intersected') {
            boxcaster.selectObjects([...this], selects);
        }
    }

    FaceGroup.prototype.intersectsBounds = function (boxcaster: Boxcaster) {
        const { matrixWorld, geometry } = this.mesh;

        if (geometry.boundingBox === null) geometry.computeBoundingBox();
        _box.copy(geometry.boundingBox!);
        _box.applyMatrix4(matrixWorld);
        _frustum.copy(boxcaster.frustum);

        if (_frustum.containsBox(_box)) {
            return 'contained';
        } else if (_frustum.intersectsBox(_box)) {
            return 'intersected';
        } else {
            return 'not-intersected';
        }
    }

    Face.prototype.intersectsBounds = function (boxcaster: Boxcaster) {
        const parent = this.parent as FaceGroup;
        const { matrixWorld } = parent.mesh;
        if (this.boundingBox === undefined) this.computeBoundingBox();
        _box.copy(this.boundingBox!);
        _box.applyMatrix4(matrixWorld);
        _frustum.copy(boxcaster.frustum);

        if (_frustum.containsBox(_box)) {
            return 'contained';
        } else if (_frustum.intersectsBox(_box)) {
            return 'intersected';
        } else {
            return 'not-intersected';
        }
    }

    Face.prototype.boxcast = function (type: IntersectionType, boxcaster: Boxcaster, selects: Boxcastable[]) {
        if (type == 'contained') {
            selects.push(this);
        } else if (type == 'intersected') {
            boxcaster.selectGeometry(this, selects);
        }
    }

    Face.prototype.containsGeometry = function (boxcaster: Boxcaster) {
        const parent = this.parent as FaceGroup;
        const { matrixWorld, geometry } = parent.mesh;
        const { group } = this;
        const { drawRange } = geometry;
        const index = geometry.index!;

        const position = geometry.attributes.position;

        _frustum.copy(boxcaster.frustum);
        _inverseMatrix.copy(matrixWorld).invert();
        _frustum.applyMatrix4(_inverseMatrix);

        const start = Math.max(group.start, drawRange.start);
        const end = Math.min(index.count, Math.min((group.start + group.count), (drawRange.start + drawRange.count)));

        for (let i = start; i < end; i++) {
            const j = index.getX(i);
            _v.fromBufferAttribute(position, j);
            if (!_frustum.containsPoint(_v)) return false;
        }
        return true;
    }

    Face.prototype.intersectsGeometry = function (boxcaster: Boxcaster) {
        const parent = this.parent as FaceGroup;
        const { matrixWorld, geometry } = parent.mesh;
        const { group } = this;
        const { drawRange } = geometry;
        const index = geometry.index!;

        const position = geometry.attributes.position;

        _frustum.copy(boxcaster.frustum);
        _inverseMatrix.copy(matrixWorld).invert();
        _frustum.applyMatrix4(_inverseMatrix);

        const start = Math.max(group.start, drawRange.start);
        const end = Math.min(index.count, Math.min((group.start + group.count), (drawRange.start + drawRange.count)));

        for (let i = start; i < end; i += 3) {
            const a = index.getX(i + 0);
            const b = index.getX(i + 1);
            const c = index.getX(i + 2);
            _v.fromBufferAttribute(position, a);
            if (_frustum.containsPoint(_v)) return true;
            _v.fromBufferAttribute(position, b);
            if (_frustum.containsPoint(_v)) return true;
            _v.fromBufferAttribute(position, c);
            if (_frustum.containsPoint(_v)) return true;

            _line.start.fromBufferAttribute(position, a);
            _line.end.fromBufferAttribute(position, b);
            if (_frustum.intersectsLine(_line)) return true;

            _line.start.fromBufferAttribute(position, a);
            _line.end.fromBufferAttribute(position, c);
            if (_frustum.intersectsLine(_line)) return true;

            _line.start.fromBufferAttribute(position, b);
            _line.end.fromBufferAttribute(position, c);
            if (_frustum.intersectsLine(_line)) return true;
        }
        return false;
    }

    CurveGroup.prototype.intersectsBounds = function (boxcaster: Boxcaster) {
        const { mesh: { matrixWorld }, line: { geometry } } = this;

        if (geometry.boundingBox === null) geometry.computeBoundingBox();
        _box.copy(geometry.boundingBox!);
        _box.applyMatrix4(matrixWorld);
        _frustum.copy(boxcaster.frustum);

        if (_frustum.containsBox(_box)) {
            return 'contained';
        } else if (_frustum.intersectsBox(_box)) {
            return 'intersected';
        } else {
            return 'not-intersected';
        }
    }

    CurveGroup.prototype.boxcast = function (type: IntersectionType, boxcaster: Boxcaster, selects: Boxcastable[]) {
        if (type == 'contained') {
            for (const edge of this) {
                selects.push(edge);
            }
        } else if (type == 'intersected') {
            boxcaster.selectObjects([...this], selects);
        }
    }

    CurveEdge.prototype.boxcast = function (type: IntersectionType, boxcaster: Boxcaster, selects: Boxcastable[]) {
        if (type == 'contained') {
            selects.push(this);
        } else if (type == 'intersected') {
            boxcaster.selectGeometry(this, selects);
        }
    }

    CurveEdge.prototype.intersectsBounds = function (boxcaster: Boxcaster) {
        const parent = this.parent as CurveGroup<CurveEdge>;
        const { line: { matrixWorld } } = parent;
        if (this.boundingBox === undefined) this.computeBoundingBox();
        _box.copy(this.boundingBox!);
        _box.applyMatrix4(matrixWorld);

        if (boxcaster.frustum.containsPoint(_box.min) && boxcaster.frustum.containsPoint(_box.max)) {
            return 'contained';
        } else if (boxcaster.frustum.intersectsBox(_box)) {
            return 'intersected';
        } else {
            return 'not-intersected';
        }
    }

    CurveEdge.prototype.containsGeometry = function (boxcaster: Boxcaster) {
        const parent = this.parent as CurveGroup<CurveEdge>;
        const { line: { geometry, matrixWorld } } = parent;
        const { group } = this;

        const instanceStart = geometry.attributes.instanceStart as THREE.InterleavedBufferAttribute;
        const array = instanceStart.data.array as Float32Array;

        _frustum.copy(boxcaster.frustum);
        _inverseMatrix.copy(matrixWorld).invert();
        _frustum.applyMatrix4(_inverseMatrix);

        const start = group.start / 3;
        const end = (group.start + group.count) / 3;

        for (let i = start; i <= end; i++) {
            _v.set(array[3 * i + 0], array[3 * i + 1], array[3 * i + 2]);
            if (!_frustum.containsPoint(_v)) return false;
        }
        return true;
    }

    CurveEdge.prototype.intersectsGeometry = function (boxcaster: Boxcaster) {
        const parent = this.parent as CurveGroup<CurveEdge>;
        const { line: { geometry, matrixWorld } } = parent;
        const { group } = this;

        const instanceStart = geometry.attributes.instanceStart as THREE.InterleavedBufferAttribute;
        const instanceEnd = geometry.attributes.instanceEnd; // camera forward is negative
        const array = instanceStart.data.array as Float32Array;

        _frustum.copy(boxcaster.frustum);
        _inverseMatrix.copy(matrixWorld).invert();
        _frustum.applyMatrix4(_inverseMatrix);

        const start = group.start / 3 / 2;
        const end = (group.start + group.count) / 3 / 2;

        for (let i = start; i <= end; i++) {
            _line.start.fromBufferAttribute(instanceStart, i);
            _line.end.fromBufferAttribute(instanceEnd, i);

            if (_frustum.containsPoint(_line.start)) return true;
            if (_frustum.containsPoint(_line.end)) return true;
            if (_frustum.intersectsLine(_line)) return true;
        }
        return false;
    }
}

Curves: {
    SpaceInstance.prototype.boxcast = function (type: IntersectionType, boxcaster: Boxcaster, selects: Boxcastable[]) {
        const underlying = this.underlying as Curve3D;
        return underlying.boxcast(type, boxcaster, selects);
    }

    SpaceInstance.prototype.intersectsBounds = function (boxcaster: Boxcaster) {
        const underlying = this.underlying as Curve3D;
        return underlying.intersectsBounds(boxcaster);
    }

    Curve3D.prototype.boxcast = function (type: IntersectionType, boxcaster: Boxcaster, selects: Boxcastable[]) {
        return this.segments.boxcast(type, boxcaster, selects);
    }

    Curve3D.prototype.intersectsBounds = function (boxcaster: Boxcaster) {
        return this.segments.intersectsBounds(boxcaster);
    }

    CurveSegment.prototype.boxcast = function (type: IntersectionType, boxcaster: Boxcaster, selects: Boxcastable[]) {
        if (type == 'contained') {
            selects.push(this);
        } else if (type == 'intersected') {
            boxcaster.selectGeometry(this, selects);
        }
    }

    CurveSegment.prototype.intersectsBounds = function (boxcaster: Boxcaster) {
        const parent = this.parent as CurveGroup<CurveEdge>;
        const { line: { matrixWorld } } = parent;
        if (this.boundingBox === undefined) this.computeBoundingBox();
        _box.copy(this.boundingBox!);
        _box.applyMatrix4(matrixWorld);

        if (boxcaster.frustum.containsPoint(_box.min) && boxcaster.frustum.containsPoint(_box.max)) {
            return 'contained';
        } else if (boxcaster.frustum.intersectsBox(_box)) {
            return 'intersected';
        } else {
            return 'not-intersected';
        }
    }

    CurveSegment.prototype.containsGeometry = function (boxcaster: Boxcaster) {
        const parent = this.parent as CurveGroup<CurveEdge>;
        const { line: { geometry, matrixWorld } } = parent;
        const { group } = this;

        const instanceStart = geometry.attributes.instanceStart as THREE.InterleavedBufferAttribute;
        const array = instanceStart.data.array as Float32Array;

        _frustum.copy(boxcaster.frustum);
        _inverseMatrix.copy(matrixWorld).invert();
        _frustum.applyMatrix4(_inverseMatrix);

        const start = group.start / 3;
        const end = (group.start + group.count) / 3;

        for (let i = start; i <= end; i++) {
            _v.set(array[3 * i + 0], array[3 * i + 1], array[3 * i + 2]);
            if (!_frustum.containsPoint(_v)) return false;
        }
        return true;
    }

    CurveSegment.prototype.intersectsGeometry = function (boxcaster: Boxcaster) {
        const parent = this.parent as CurveGroup<CurveEdge>;
        const { line: { geometry, matrixWorld } } = parent;
        const { group } = this;

        const instanceStart = geometry.attributes.instanceStart as THREE.InterleavedBufferAttribute;
        const instanceEnd = geometry.attributes.instanceEnd; // camera forward is negative
        const array = instanceStart.data.array as Float32Array;

        _frustum.copy(boxcaster.frustum);
        _inverseMatrix.copy(matrixWorld).invert();
        _frustum.applyMatrix4(_inverseMatrix);

        const start = group.start / 3 / 2;
        const end = (group.start + group.count) / 3 / 2;

        for (let i = start; i <= end; i++) {
            _line.start.fromBufferAttribute(instanceStart, i);
            _line.end.fromBufferAttribute(instanceEnd, i);

            if (_frustum.containsPoint(_line.start)) return true;
            if (_frustum.containsPoint(_line.end)) return true;
            if (_frustum.intersectsLine(_line)) return true;
        }
        return false;
    }
}

Regions: {
    PlaneInstance.prototype.boxcast = function (type: IntersectionType, boxcaster: Boxcaster, selects: Boxcastable[]) {
        const underlying = this.underlying as Region;
        return underlying.boxcast(type, boxcaster, selects);
    }

    PlaneInstance.prototype.intersectsBounds = function (boxcaster: Boxcaster) {
        const underlying = this.underlying as Region;
        return underlying.intersectsBounds(boxcaster);
    }

    Region.prototype.intersectsBounds = function (boxcaster: Boxcaster) {
        const { matrixWorld, geometry } = this.mesh;
        if (geometry.boundingBox === null) geometry.computeBoundingBox();
        _box.copy(geometry.boundingBox!);
        _box.applyMatrix4(matrixWorld);
        _frustum.copy(boxcaster.frustum);

        if (_frustum.containsBox(_box)) {
            return 'contained';
        } else if (_frustum.intersectsBox(_box)) {
            return 'intersected';
        } else {
            return 'not-intersected';
        }
    }

    Region.prototype.boxcast = function (type: IntersectionType, boxcaster: Boxcaster, selects: Boxcastable[]) {
        if (type == 'contained') {
            selects.push(this);
        } else if (type == 'intersected') {
            boxcaster.selectGeometry(this, selects);
        }
    }

    Region.prototype.containsGeometry = function (boxcaster: Boxcaster) {
        const { matrixWorld, geometry } = this.mesh;
        const { drawRange } = geometry;
        const index = geometry.index!;

        const position = geometry.attributes.position;

        _frustum.copy(boxcaster.frustum);
        _inverseMatrix.copy(matrixWorld).invert();
        _frustum.applyMatrix4(_inverseMatrix);

        const start = drawRange.start;
        const end = Math.min(index.count, drawRange.start + drawRange.count);

        for (let i = start; i < end; i++) {
            const j = index.getX(i);
            _v.fromBufferAttribute(position, j);
            if (!_frustum.containsPoint(_v)) return false;
        }
        return true;
    }

    Region.prototype.intersectsGeometry = function (boxcaster: Boxcaster) {
        const { matrixWorld, geometry } = this.mesh;
        const { drawRange } = geometry;
        const index = geometry.index!;

        const position = geometry.attributes.position;

        _frustum.copy(boxcaster.frustum);
        _inverseMatrix.copy(matrixWorld).invert();
        _frustum.applyMatrix4(_inverseMatrix);

        const start = drawRange.start;
        const end = Math.min(index.count, drawRange.start + drawRange.count);
        
        for (let i = start; i < end; i += 3) {
            const a = index.getX(i + 0);
            const b = index.getX(i + 1);
            const c = index.getX(i + 2);
            _v.fromBufferAttribute(position, a);
            if (_frustum.containsPoint(_v)) return true;
            _v.fromBufferAttribute(position, b);
            if (_frustum.containsPoint(_v)) return true;
            _v.fromBufferAttribute(position, c);
            if (_frustum.containsPoint(_v)) return true;

            _line.start.fromBufferAttribute(position, a);
            _line.end.fromBufferAttribute(position, b);
            if (_frustum.intersectsLine(_line)) return true;

            _line.start.fromBufferAttribute(position, a);
            _line.end.fromBufferAttribute(position, c);
            if (_frustum.intersectsLine(_line)) return true;

            _line.start.fromBufferAttribute(position, b);
            _line.end.fromBufferAttribute(position, c);
            if (_frustum.intersectsLine(_line)) return true;
        }
        return false;
    }
}

class FastFrustum extends THREE.Frustum {
    applyMatrix4(matrix: THREE.Matrix4) {
        for (const plane of this.planes) {
            plane.applyMatrix4(matrix);
        }
        return this;
    }

    intersectsLine(line: THREE.Line3): boolean {
        for (const plane of this.planes) {
            if (plane.intersectsLine(line)) return true;
        }
        return false;
    }

    containsBox(box: THREE.Box3): boolean {
        _points[0].set(box.min.x, box.min.y, box.min.z);
        _points[1].set(box.min.x, box.min.y, box.max.z);
        _points[2].set(box.min.x, box.max.y, box.min.z);
        _points[3].set(box.min.x, box.max.y, box.max.z);
        _points[4].set(box.max.x, box.min.y, box.min.z);
        _points[5].set(box.max.x, box.min.y, box.max.z);
        _points[6].set(box.max.x, box.max.y, box.min.z);
        _points[7].set(box.max.x, box.max.y, box.max.z);
        for (const point of _points) {
            if (!this.containsPoint(point)) return false;
        }
        return true;
    }
}

const _frustum = new FastFrustum();
const _v = new THREE.Vector3();
const _inverseMatrix = new THREE.Matrix4();
const _box = new THREE.Box3();
const _line = new THREE.Line3();

const _points = [
    new THREE.Vector3(),
    new THREE.Vector3(),
    new THREE.Vector3(),
    new THREE.Vector3(),
    new THREE.Vector3(),
    new THREE.Vector3(),
    new THREE.Vector3(),
    new THREE.Vector3()
];
export { };