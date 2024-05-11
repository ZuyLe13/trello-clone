import Box from '@mui/material/Box'
import ListColumns from './ListColumns/ListColumns'
import { mapOrder } from '~/utils/sorts'
import {
  DndContext,
  useSensor,
  useSensors,
  MouseSensor,
  TouchSensor,
  DragOverlay,
  defaultDropAnimationSideEffects,
  closestCorners,
  pointerWithin,
  rectIntersection,
  getFirstCollision,
  closestCenter
} from '@dnd-kit/core'
import { arrayMove } from '@dnd-kit/sortable'
import { useCallback, useEffect, useRef, useState } from 'react'
import { cloneDeep, over } from 'lodash'

import Column from './ListColumns/Column/Column'
import Card from './ListColumns/Column/ListCards/Card/Card'

const ACTIVE_DRAG_ITEM_TYPE = {
  COLUMN: 'ACTIVE_DRAG_ITEM_TYPE_COLUMN',
  CARD: 'ACTIVE_DRAG_ITEM_TYPE_CARD'
}

function BoardContent({ board }) {
  // Nếu dùng PointerSensor mặc định thì phải kết hợp thuộc tính CSS touch-action: 'none' ở những phần tử kéo thả
  // nhưng còn bug
  // const pointerSensor = useSensor(PointerSensor, { activationConstraint: { distance: 10 } })

  // Yêu cầu chuột di chuyển 10px thì mới kích hoạt event, fix trường hợp click bị gọi event
  const mouseSensor = useSensor(MouseSensor, { activationConstraint: { distance: 10 } })

  // Nhấn giữ 250ms và dung sai của cảm ứng 5px thì mới kích hoạt event
  const touchSensor = useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 5 } })

  // Ưu tiên sử dụng kết hợp 2 loại sensor là mouse và touch để có trải nghiệm trên mobile tốt nhất
  // const sensors = useSensors(pointerSensor)
  const sensors = useSensors(mouseSensor, touchSensor)

  const [orderedColumns, setOrderedColumns] = useState([])

  // Cùng một thời điểm chỉ có một phần tử được kéo (column or card)
  const [activeDragItemId, setActiveDragItemId] = useState(null)
  const [activeDragItemType, setActiveDragItemType] = useState(null)
  const [activeDragItemData, setActiveDragItemData] = useState(null)
  const [oldColumnDraggingCard, setOldColumnDraggingCard] = useState(null)

  // Điểm va chạm cuối cùng trước đó (thuật toán va chạm)
  const lastOverId = useRef()

  useEffect(() => {
    setOrderedColumns(mapOrder(board?.columns, board?.columnOrderIds, '_id'))
  }, [board])

  const findColumnByCardId = (cardId) => {
    return orderedColumns.find(column => column?.cards?.map(card => card._id)?.includes(cardId))
  }

  // Function chung xử lý việc cập nhật lại state trong trường hợp di chuyển card giữa các column khác nhau
  const moveCardBetweenDifferentColumns = (
    overColumn,
    overCardId,
    active,
    over,
    activeColumn,
    activeDraggingCardId,
    activeDraggingCardData
  ) => {
    setOrderedColumns(prevColumns => {
      // Tìm vị trí của overCard trong column đích (vị trí card sắp được thả)
      const overCardIndex = overColumn?.cards?.findIndex(card => card._id === overCardId)

      // Logic xử lý cardIndex mới (trên hoặc dưới overCard)
      let newCardIndex
      const isBelowOverItem = active.rect.current.translated &&
        active.rect.current.translated.top > over.rect.top + over.rect.height
      const modifier = isBelowOverItem ? 1 : 0

      newCardIndex = overCardIndex >= 0 ? overCardIndex + modifier : overColumn?.cards?.length + 1

      // Clone mảng orderedColumnsState cũ ra một mảng mới để xử lý data rồi return - cập nhật lại orderedColumnsState mới
      const nextColumns = cloneDeep(prevColumns)
      const nextActiveColumns = nextColumns.find(column => column._id === activeColumn._id)
      const nextOverColumns = nextColumns.find(column => column._id === overColumn._id)

      // Column cũ
      if (nextActiveColumns) {
        // Xóa card ở column active (column cũ)
        nextActiveColumns.cards = nextActiveColumns.cards.filter(card => card._id !== activeDraggingCardId)

        // Cập nhật lại mảng cardOrderIds cho chuẩn dữ liệu
        nextActiveColumns.cardOrderIds = nextActiveColumns.cards.map(card => card._id)
      }

      // Column mới
      if (nextOverColumns) {
        // Kiểm tra xem card đang kéo có tồn tại ở overColumn chưa, nếu chưa thì cần xóa nó trước
        nextOverColumns.cards = nextOverColumns.cards.filter(card => card._id !== activeDraggingCardId)

        // Phải cập nhật lại chuẩn dữ liệu columnId trong card sau khi kéo card giữa 2 column khác nhau
        const rebuild_activeDraggingCardData = {
          ...activeDraggingCardData,
          columnId: nextOverColumns._id
        }

        // Tiếp theo thêm card đang kéo vào overColumn theo vị trí index mới
        nextOverColumns.cards = nextOverColumns.cards.toSpliced(newCardIndex, 0, rebuild_activeDraggingCardData)

        // Cập nhật lại mảng cardOrderIds cho chuẩn dữ liệu
        nextOverColumns.cardOrderIds = nextOverColumns.cards.map(card => card._id)
      }

      return nextColumns
    })
  }

  // Trigger khi bắt đầu kéo một phần tử
  const handleDragStart = (event) => {
    setActiveDragItemId(event?.active?.id)
    setActiveDragItemType(event?.active?.data?.current?.columnId ? ACTIVE_DRAG_ITEM_TYPE.CARD : ACTIVE_DRAG_ITEM_TYPE.COLUMN)
    setActiveDragItemData(event?.active?.data?.current)

    // Nếu là kéo card thì mới thực hiện hành động set giá trị oldColumn
    if (event?.active?.data?.current?.columnId) {
      setOldColumnDraggingCard(findColumnByCardId(event?.active?.id))
    }
  }

  // Trigger trong quá trình kéo một phần tử
  const handleDragOver = (event) => {
    if (activeDragItemType === ACTIVE_DRAG_ITEM_TYPE.COLUMN) return

    const { active, over } = event

    // Kiểm tra nếu không tồn tại over (kéo linh tinh ra ngoài thì return tránh lỗi)
    if (!active || !over) return

    // activeDraggingCard: là card đang được kéo
    const { id: activeDraggingCardId, data: { current: activeDraggingCardData } } = active

    // overCard: là card đang tương tác trên hoặc dưới so với card đang được kéo ở trên
    const { id: overCardId } = over

    // Tìm 2 columns theo cardId
    const activeColumn = findColumnByCardId(activeDraggingCardId)
    const overColumn = findColumnByCardId(overCardId)

    if (!activeColumn || !overColumn) return

    // Xử lý logic ở đây chỉ khi kéo card qua column khác nhau, còn nếu kéo card trong chính column ban đầu thì không làm gì
    if (activeColumn._id !== overColumn._id) {
      moveCardBetweenDifferentColumns(
        overColumn,
        overCardId,
        active,
        over,
        activeColumn,
        activeDraggingCardId,
        activeDraggingCardData
      )
    }
  }

  // Trigger khi kết thúc hành động kéo (drag) một phần tử => hành động thả (drop)
  const handleDragEnd = (event) => {
    const { active, over } = event

    // Kiểm tra nếu không tồn tại over (kéo linh tinh ra ngoài thì return tránh lỗi)
    if (!active || !over) return

    // Xử lý kéo thả card
    if (activeDragItemType === ACTIVE_DRAG_ITEM_TYPE.CARD) {
      // activeDraggingCard: là card đang được kéo
      const { id: activeDraggingCardId, data: { current: activeDraggingCardData } } = active

      // overCard: là card đang tương tác trên hoặc dưới so với card đang được kéo ở trên
      const { id: overCardId } = over

      // Tìm 2 columns theo cardId
      const activeColumn = findColumnByCardId(activeDraggingCardId)
      const overColumn = findColumnByCardId(overCardId)

      // Nếu không tồn tại 1 trong 2 column thì không làm gì hết, tránh cash trang
      if (!activeColumn || !overColumn) return

      if (oldColumnDraggingCard._id !== overColumn._id) {
        // Kéo thả card giữa 2 column khác nhau
        moveCardBetweenDifferentColumns(
          overColumn,
          overCardId,
          active,
          over,
          activeColumn,
          activeDraggingCardId,
          activeDraggingCardData
        )
      } else {
        // Kéo thả card trong cùng một column
        const oldCardIndex = oldColumnDraggingCard?.cards?.findIndex(c => c._id === activeDragItemId)
        const newCardIndex = overColumn?.cards?.findIndex(c => c._id === overCardId)

        // Dùng arrayMove vì kéo card trong một column thì tương tự logic kéo column trong một boardContent
        const dndOrderedCards = arrayMove(oldColumnDraggingCard?.cards, oldCardIndex, newCardIndex)

        setOrderedColumns(prevColumns => {
          // Clone mảng orderedColumnsState cũ ra một mảng mới để xử lý data rồi return - cập nhật lại orderedColumnsState mới
          const nextColumns = cloneDeep(prevColumns)

          // Tìm tới column mà chúng ta thả
          const targetColumn = nextColumns.find(column => column._id === overColumn._id)

          // Cập nhật lại 2 giá trị mới là card và cardOrderIds trong targetColumn
          targetColumn.cards = dndOrderedCards
          targetColumn.cardOrderIds = dndOrderedCards.map(card => card._id)

          return nextColumns
        })
      }
    }

    // Xử lý kéo thả column trong boardContent
    if (activeDragItemType === ACTIVE_DRAG_ITEM_TYPE.COLUMN) {
      if (active.id !== over.id) {
        // Lấy vị trí cũ từ active, vị trí mới từ over
        const oldColumnIndex = orderedColumns.findIndex(c => c._id === active.id)
        const newColumnIndex = orderedColumns.findIndex(c => c._id === over.id)

        // Dùng để xử lý gọi API
        // const dndOrderedColumnsIds = dndOrderedColumns.map(c => c._id)

        const dndOrderedColumns = arrayMove(orderedColumns, oldColumnIndex, newColumnIndex)
        setOrderedColumns(dndOrderedColumns)
      }
    }

    setActiveDragItemId(null)
    setActiveDragItemType(null)
    setActiveDragItemData(null)
    setOldColumnDraggingCard(null)
  }

  const dropAnimation = {
    sideEffects: defaultDropAnimationSideEffects({
      styles: { active: { opacity: '0.5' } }
    })
  }

  const collisionDetectionStrategy = useCallback((args) => {
    if (activeDragItemType === ACTIVE_DRAG_ITEM_TYPE.COLUMN) {
      return closestCorners({ ...args })
    }

    // Tìm các điểm giao nhau, va chạm với con trỏ
    const pointerIntersections = pointerWithin(args)

    // Thuật toán phát hiện va chạm sẽ trả về một mảng các va chạm
    const intersections = pointerIntersections?.length > 0 ? pointerIntersections : rectIntersection

    // Tìm overId đầu tiên trong các intersections ở trên
    let overId = getFirstCollision(intersections, 'id')

    if (overId) {
      const checkColumn = orderedColumns.find(column => column._id == overId)
      if (checkColumn) {
        overId = closestCenter({
          ...args,
          droppableContainers: args.droppableContainers.filter(container =>
            container.id !== overId && checkColumn?.cardOrderIds?.includes(container.id)
          )
        })[0]?.id
      }

      lastOverId.current = overId
      return [{ id: overId }]
    }

    return lastOverId.current ? [{ id: lastOverId.current }] : []

  }, [activeDragItemType])

  return (
    <DndContext
      sensors={sensors}
      // Thuật toán phát hiện va chạm (nếu ko có nó thì card có cover lớn sẽ không kéo qua column khác được vì lúc này nó đang
      // bị conflict giữa card và column) https://docs.dndkit.com/api-documentation/context-provider/collision-detection-algorithms
      // collisionDetection={closestCorners}

      // Tự custom nâng cao thuật toán va chạm
      collisionDetection={collisionDetectionStrategy}


      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd} >
      <Box sx={{
        width: '100%',
        height: (theme) => theme.trello.boardContentHeight,
        bgcolor: (theme) => (theme.palette.mode === 'dark' ? '#34495e' : '#1976d2'),
        p: '6px 0'
      }}>

        {/* List Column */}
        <ListColumns columns={orderedColumns} />
        <DragOverlay dropAnimation={dropAnimation}>
          {(!activeDragItemType) && null}
          {(activeDragItemType === ACTIVE_DRAG_ITEM_TYPE.COLUMN) && <Column column={activeDragItemData} />}
          {(activeDragItemType === ACTIVE_DRAG_ITEM_TYPE.CARD) && <Card card={activeDragItemData} />}
        </DragOverlay>
      </Box>
    </DndContext>
  )
}

export default BoardContent
