import { Liveblocks } from "@liveblocks/node"
import { auth } from "@/lib/auth/config"
import { db } from "@/lib/db"

function getLiveblocksClient() {
  if (!process.env.LIVEBLOCKS_SECRET) {
    return null
  }
  return new Liveblocks({
    secret: process.env.LIVEBLOCKS_SECRET,
  })
}

const client = getLiveblocksClient()

export async function authorizeLiveblocksAccess(roomId: string) {
  const session = await auth()
  if (!session?.user) {
    return null
  }

  // Verify user has access to the file
  const fileId = roomId.replace("file_", "")
  const file = await db.file.findUnique({
    where: { id: fileId },
    include: {
      project: {
        include: {
          members: true
        }
      }
    }
  })

  if (!file) {
    return null
  }

  const member = file.project.members.find(
    m => m.userId === session.user!.id
  )

  if (!member) {
    return null
  }

  return {
    userId: session.user!.id,
    roomId,
    userInfo: {
      name: session.user.name || "",
      avatar: session.user.image || "",
      role: member.role,
    },
  }
}

export default client
