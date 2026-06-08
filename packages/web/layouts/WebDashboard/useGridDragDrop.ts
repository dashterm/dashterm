import { useState, useEffect, useCallback, useRef } from 'react';
import { SpaceAppLayout, Space } from '../../../core/types';

export interface DragState {
  appId: string;
  startColumn: number;
  startRow: number;
  startMouseX: number;
  startMouseY: number;
  currentColumn: number;
  currentRow: number;
}

export interface ResizeState {
  appId: string;
  edge: 'right' | 'bottom' | 'corner';
  startColSpan: number;
  startRowSpan: number;
  startMouseX: number;
  startMouseY: number;
  currentColSpan: number;
  currentRowSpan: number;
}

interface UseGridDragDropProps {
  activeSpace: Space & { apps: SpaceAppLayout[] };
  cellWidth: number;
  cellHeight: number;
  gap: number;
  updateAppInSpace: (spaceId: string, appId: string, updates: Partial<SpaceAppLayout>) => void;
}

export function useGridDragDrop({
  activeSpace,
  cellWidth,
  cellHeight,
  gap,
  updateAppInSpace,
}: UseGridDragDropProps) {
  const [dragState, setDragState] = useState<DragState | null>(null);
  const [resizeState, setResizeState] = useState<ResizeState | null>(null);
  const gridRef = useRef<HTMLDivElement>(null);

  // Convert mouse position to grid cell
  const getGridCell = useCallback(
    (mouseX: number, mouseY: number): { column: number; row: number } => {
      if (!gridRef.current) return { column: 0, row: 0 };

      const rect = gridRef.current.getBoundingClientRect();
      const relX = mouseX - rect.left;
      const relY = mouseY - rect.top;

      const column = Math.max(
        0,
        Math.min(
          activeSpace.gridColumns - 1,
          Math.floor(relX / (cellWidth + gap))
        )
      );
      const row = Math.max(
        0,
        Math.min(
          activeSpace.gridRows - 1,
          Math.floor(relY / (cellHeight + gap))
        )
      );

      return { column, row };
    },
    [cellWidth, cellHeight, activeSpace.gridColumns, activeSpace.gridRows, gap]
  );

  // Start dragging
  const handleDragStart = useCallback(
    (appId: string, e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();

      const app = activeSpace.apps.find((a) => a.id === appId);
      if (!app) return;

      setDragState({
        appId,
        startColumn: app.column,
        startRow: app.row,
        startMouseX: e.clientX,
        startMouseY: e.clientY,
        currentColumn: app.column,
        currentRow: app.row,
      });
    },
    [activeSpace.apps]
  );

  // Start resizing
  const handleResizeStart = useCallback(
    (
      appId: string,
      edge: 'right' | 'bottom' | 'corner',
      e: React.MouseEvent
    ) => {
      e.preventDefault();
      e.stopPropagation();

      const app = activeSpace.apps.find((a) => a.id === appId);
      if (!app) return;

      setResizeState({
        appId,
        edge,
        startColSpan: app.colSpan,
        startRowSpan: app.rowSpan,
        startMouseX: e.clientX,
        startMouseY: e.clientY,
        currentColSpan: app.colSpan,
        currentRowSpan: app.rowSpan,
      });
    },
    [activeSpace.apps]
  );

  // Handle mouse move for drag/resize
  useEffect(() => {
    if (!dragState && !resizeState) return;

    const handleMouseMove = (e: MouseEvent) => {
      if (dragState) {
        const { column, row } = getGridCell(e.clientX, e.clientY);
        const app = activeSpace.apps.find((a) => a.id === dragState.appId);
        if (!app) return;

        // Clamp to valid positions considering app size
        const maxCol = activeSpace.gridColumns - app.colSpan;
        const maxRow = activeSpace.gridRows - app.rowSpan;
        const newCol = Math.max(0, Math.min(maxCol, column));
        const newRow = Math.max(0, Math.min(maxRow, row));

        setDragState((prev) =>
          prev ? { ...prev, currentColumn: newCol, currentRow: newRow } : null
        );
      }

      if (resizeState) {
        const app = activeSpace.apps.find((a) => a.id === resizeState.appId);
        if (!app) return;

        const deltaX = e.clientX - resizeState.startMouseX;
        const deltaY = e.clientY - resizeState.startMouseY;

        let newColSpan = resizeState.startColSpan;
        let newRowSpan = resizeState.startRowSpan;

        if (resizeState.edge === 'right' || resizeState.edge === 'corner') {
          const colDelta = Math.round(deltaX / (cellWidth + gap));
          newColSpan = Math.max(
            1,
            Math.min(
              activeSpace.gridColumns - app.column,
              resizeState.startColSpan + colDelta
            )
          );
        }

        if (resizeState.edge === 'bottom' || resizeState.edge === 'corner') {
          const rowDelta = Math.round(deltaY / (cellHeight + gap));
          newRowSpan = Math.max(
            1,
            Math.min(
              activeSpace.gridRows - app.row,
              resizeState.startRowSpan + rowDelta
            )
          );
        }

        setResizeState((prev) =>
          prev
            ? {
                ...prev,
                currentColSpan: newColSpan,
                currentRowSpan: newRowSpan,
              }
            : null
        );
      }
    };

    const handleMouseUp = () => {
      if (dragState) {
        // Apply the drag
        if (
          dragState.currentColumn !== dragState.startColumn ||
          dragState.currentRow !== dragState.startRow
        ) {
          const draggedApp = activeSpace.apps.find(
            (a) => a.id === dragState.appId
          );
          if (draggedApp) {
            // Find ALL colliding apps
            const collidingApps = activeSpace.apps.filter((app) => {
              if (app.id === dragState.appId) return false;

              const draggedLeft = dragState.currentColumn;
              const draggedRight = dragState.currentColumn + draggedApp.colSpan;
              const draggedTop = dragState.currentRow;
              const draggedBottom = dragState.currentRow + draggedApp.rowSpan;

              const appLeft = app.column;
              const appRight = app.column + app.colSpan;
              const appTop = app.row;
              const appBottom = app.row + app.rowSpan;

              return !(
                draggedRight <= appLeft ||
                draggedLeft >= appRight ||
                draggedBottom <= appTop ||
                draggedTop >= appBottom
              );
            });

            // Build a set of occupied cells
            const occupiedCells = new Set<string>();
            activeSpace.apps.forEach((app) => {
              if (
                collidingApps.some((ca) => ca.id === app.id) ||
                app.id === dragState.appId
              )
                return;
              for (let c = app.column; c < app.column + app.colSpan; c++) {
                for (let r = app.row; r < app.row + app.rowSpan; r++) {
                  occupiedCells.add(`${c},${r}`);
                }
              }
            });

            // Mark dragged app's NEW position as occupied
            for (
              let c = dragState.currentColumn;
              c < dragState.currentColumn + draggedApp.colSpan;
              c++
            ) {
              for (
                let r = dragState.currentRow;
                r < dragState.currentRow + draggedApp.rowSpan;
                r++
              ) {
                occupiedCells.add(`${c},${r}`);
              }
            }

            const canFitAt = (
              col: number,
              row: number,
              colSpan: number,
              rowSpan: number
            ): boolean => {
              if (
                col < 0 ||
                row < 0 ||
                col + colSpan > activeSpace.gridColumns ||
                row + rowSpan > activeSpace.gridRows
              ) {
                return false;
              }
              for (let c = col; c < col + colSpan; c++) {
                for (let r = row; r < row + rowSpan; r++) {
                  if (occupiedCells.has(`${c},${r}`)) return false;
                }
              }
              return true;
            };

            const markOccupied = (
              col: number,
              row: number,
              colSpan: number,
              rowSpan: number
            ) => {
              for (let c = col; c < col + colSpan; c++) {
                for (let r = row; r < row + rowSpan; r++) {
                  occupiedCells.add(`${c},${r}`);
                }
              }
            };

            // Move colliding apps
            collidingApps.forEach((collidingApp) => {
              // Strategy 1: Try to move down
              for (
                let tryRow = collidingApp.row + 1;
                tryRow <= activeSpace.gridRows - collidingApp.rowSpan;
                tryRow++
              ) {
                if (
                  canFitAt(
                    collidingApp.column,
                    tryRow,
                    collidingApp.colSpan,
                    collidingApp.rowSpan
                  )
                ) {
                  updateAppInSpace(activeSpace.id, collidingApp.id, {
                    column: collidingApp.column,
                    row: tryRow,
                  });
                  markOccupied(
                    collidingApp.column,
                    tryRow,
                    collidingApp.colSpan,
                    collidingApp.rowSpan
                  );
                  return;
                }
              }

              // Strategy 2: Try to move up
              for (let tryRow = collidingApp.row - 1; tryRow >= 0; tryRow--) {
                if (
                  canFitAt(
                    collidingApp.column,
                    tryRow,
                    collidingApp.colSpan,
                    collidingApp.rowSpan
                  )
                ) {
                  updateAppInSpace(activeSpace.id, collidingApp.id, {
                    column: collidingApp.column,
                    row: tryRow,
                  });
                  markOccupied(
                    collidingApp.column,
                    tryRow,
                    collidingApp.colSpan,
                    collidingApp.rowSpan
                  );
                  return;
                }
              }

              // Strategy 3: Find any available space
              for (let tryRow = 0; tryRow < activeSpace.gridRows; tryRow++) {
                for (
                  let tryCol = 0;
                  tryCol < activeSpace.gridColumns;
                  tryCol++
                ) {
                  if (
                    canFitAt(
                      tryCol,
                      tryRow,
                      collidingApp.colSpan,
                      collidingApp.rowSpan
                    )
                  ) {
                    updateAppInSpace(activeSpace.id, collidingApp.id, {
                      column: tryCol,
                      row: tryRow,
                    });
                    markOccupied(
                      tryCol,
                      tryRow,
                      collidingApp.colSpan,
                      collidingApp.rowSpan
                    );
                    return;
                  }
                }
              }

              // Strategy 4: Fallback to dragged app's original position
              updateAppInSpace(activeSpace.id, collidingApp.id, {
                column: dragState.startColumn,
                row: dragState.startRow,
              });
              markOccupied(
                dragState.startColumn,
                dragState.startRow,
                collidingApp.colSpan,
                collidingApp.rowSpan
              );
            });

            // Move dragged app to new position
            updateAppInSpace(activeSpace.id, dragState.appId, {
              column: dragState.currentColumn,
              row: dragState.currentRow,
            });
          }
        }
        setDragState(null);
      }

      if (resizeState) {
        if (
          resizeState.currentColSpan !== resizeState.startColSpan ||
          resizeState.currentRowSpan !== resizeState.startRowSpan
        ) {
          const resizingApp = activeSpace.apps.find(
            (a) => a.id === resizeState.appId
          );
          if (resizingApp) {
            // Check for collisions
            const wouldCollide = activeSpace.apps.some((app) => {
              if (app.id === resizeState.appId) return false;

              const resizedLeft = resizingApp.column;
              const resizedRight =
                resizingApp.column + resizeState.currentColSpan;
              const resizedTop = resizingApp.row;
              const resizedBottom =
                resizingApp.row + resizeState.currentRowSpan;

              const appLeft = app.column;
              const appRight = app.column + app.colSpan;
              const appTop = app.row;
              const appBottom = app.row + app.rowSpan;

              return !(
                resizedRight <= appLeft ||
                resizedLeft >= appRight ||
                resizedBottom <= appTop ||
                resizedTop >= appBottom
              );
            });

            if (!wouldCollide) {
              updateAppInSpace(activeSpace.id, resizeState.appId, {
                colSpan: resizeState.currentColSpan,
                rowSpan: resizeState.currentRowSpan,
              });
            }
          }
        }
        setResizeState(null);
      }
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [
    dragState,
    resizeState,
    getGridCell,
    activeSpace,
    cellWidth,
    cellHeight,
    gap,
    updateAppInSpace,
  ]);

  // Get app position/size considering drag/resize state
  const getAppLayout = useCallback(
    (app: SpaceAppLayout) => {
      if (dragState && dragState.appId === app.id) {
        return {
          column: dragState.currentColumn,
          row: dragState.currentRow,
          colSpan: app.colSpan,
          rowSpan: app.rowSpan,
        };
      }
      if (resizeState && resizeState.appId === app.id) {
        return {
          column: app.column,
          row: app.row,
          colSpan: resizeState.currentColSpan,
          rowSpan: resizeState.currentRowSpan,
        };
      }
      return {
        column: app.column,
        row: app.row,
        colSpan: app.colSpan,
        rowSpan: app.rowSpan,
      };
    },
    [dragState, resizeState]
  );

  // Find all apps that would collide during drag
  const getCollidingApps = useCallback(() => {
    if (!dragState) return [];

    const draggedApp = activeSpace.apps.find((a) => a.id === dragState.appId);
    if (!draggedApp) return [];

    return activeSpace.apps.filter((app) => {
      if (app.id === dragState.appId) return false;

      const draggedLeft = dragState.currentColumn;
      const draggedRight = dragState.currentColumn + draggedApp.colSpan;
      const draggedTop = dragState.currentRow;
      const draggedBottom = dragState.currentRow + draggedApp.rowSpan;

      const appLeft = app.column;
      const appRight = app.column + app.colSpan;
      const appTop = app.row;
      const appBottom = app.row + app.rowSpan;

      return !(
        draggedRight <= appLeft ||
        draggedLeft >= appRight ||
        draggedBottom <= appTop ||
        draggedTop >= appBottom
      );
    });
  }, [dragState, activeSpace.apps]);

  // Calculate predicted positions for colliding apps
  const getPredictedPositions = useCallback(() => {
    const collidingApps = getCollidingApps();
    if (!dragState || collidingApps.length === 0)
      return new Map<string, { column: number; row: number }>();

    const draggedApp = activeSpace.apps.find((a) => a.id === dragState.appId);
    if (!draggedApp) return new Map();

    const positions = new Map<string, { column: number; row: number }>();

    const occupiedCells = new Set<string>();
    activeSpace.apps.forEach((app) => {
      if (
        collidingApps.some((ca) => ca.id === app.id) ||
        app.id === dragState.appId
      )
        return;
      for (let c = app.column; c < app.column + app.colSpan; c++) {
        for (let r = app.row; r < app.row + app.rowSpan; r++) {
          occupiedCells.add(`${c},${r}`);
        }
      }
    });

    for (
      let c = dragState.currentColumn;
      c < dragState.currentColumn + draggedApp.colSpan;
      c++
    ) {
      for (
        let r = dragState.currentRow;
        r < dragState.currentRow + draggedApp.rowSpan;
        r++
      ) {
        occupiedCells.add(`${c},${r}`);
      }
    }

    const canFitAt = (
      col: number,
      row: number,
      colSpan: number,
      rowSpan: number
    ): boolean => {
      if (
        col < 0 ||
        row < 0 ||
        col + colSpan > activeSpace.gridColumns ||
        row + rowSpan > activeSpace.gridRows
      ) {
        return false;
      }
      for (let c = col; c < col + colSpan; c++) {
        for (let r = row; r < row + rowSpan; r++) {
          if (occupiedCells.has(`${c},${r}`)) return false;
        }
      }
      return true;
    };

    const markOccupied = (
      col: number,
      row: number,
      colSpan: number,
      rowSpan: number
    ) => {
      for (let c = col; c < col + colSpan; c++) {
        for (let r = row; r < row + rowSpan; r++) {
          occupiedCells.add(`${c},${r}`);
        }
      }
    };

    collidingApps.forEach((collidingApp) => {
      for (
        let tryRow = collidingApp.row + 1;
        tryRow <= activeSpace.gridRows - collidingApp.rowSpan;
        tryRow++
      ) {
        if (
          canFitAt(
            collidingApp.column,
            tryRow,
            collidingApp.colSpan,
            collidingApp.rowSpan
          )
        ) {
          positions.set(collidingApp.id, {
            column: collidingApp.column,
            row: tryRow,
          });
          markOccupied(
            collidingApp.column,
            tryRow,
            collidingApp.colSpan,
            collidingApp.rowSpan
          );
          return;
        }
      }

      for (let tryRow = collidingApp.row - 1; tryRow >= 0; tryRow--) {
        if (
          canFitAt(
            collidingApp.column,
            tryRow,
            collidingApp.colSpan,
            collidingApp.rowSpan
          )
        ) {
          positions.set(collidingApp.id, {
            column: collidingApp.column,
            row: tryRow,
          });
          markOccupied(
            collidingApp.column,
            tryRow,
            collidingApp.colSpan,
            collidingApp.rowSpan
          );
          return;
        }
      }

      for (let tryRow = 0; tryRow < activeSpace.gridRows; tryRow++) {
        for (let tryCol = 0; tryCol < activeSpace.gridColumns; tryCol++) {
          if (
            canFitAt(tryCol, tryRow, collidingApp.colSpan, collidingApp.rowSpan)
          ) {
            positions.set(collidingApp.id, { column: tryCol, row: tryRow });
            markOccupied(
              tryCol,
              tryRow,
              collidingApp.colSpan,
              collidingApp.rowSpan
            );
            return;
          }
        }
      }

      positions.set(collidingApp.id, {
        column: dragState.startColumn,
        row: dragState.startRow,
      });
      markOccupied(
        dragState.startColumn,
        dragState.startRow,
        collidingApp.colSpan,
        collidingApp.rowSpan
      );
    });

    return positions;
  }, [dragState, getCollidingApps, activeSpace]);

  return {
    dragState,
    resizeState,
    gridRef,
    handleDragStart,
    handleResizeStart,
    getAppLayout,
    getCollidingApps,
    getPredictedPositions,
  };
}
