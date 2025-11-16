import { Router, Request, Response } from 'express';
import pool from '../config/database';
import { adminAuth } from '../middleware/adminAuth';
import { RowDataPacket } from 'mysql2';
import {
    getAllUsers,
    getUserById,
    updateUser,
    deleteUser,
    createUser
} from '../controllers/user.controller';

const router = Router();

/*--------------------------------------------------
 🧾 Lấy danh sách yêu cầu nạp tiền
--------------------------------------------------*/
router.get('/deposits', adminAuth, async (req: Request, res: Response) => {
    try {
        const [rows] = await pool.query(`
            SELECT dr.*, u.email AS user_email 
            FROM deposit_requests dr 
            JOIN users u ON dr.user_id = u.id 
            ORDER BY dr.created_at DESC
        `) as [RowDataPacket[], any];

        res.json(rows);
    } catch (error) {
        console.error('❌ Lỗi lấy danh sách nạp tiền:', error);
        res.status(500).json({ error: 'Lỗi server khi lấy danh sách nạp tiền' });
    }
});

/*--------------------------------------------------
  Duyệt yêu cầu nạp tiền (FIXED)
--------------------------------------------------*/
router.put('/deposits/:id/approve', adminAuth, async (req: Request, res: Response) => {
    const connection = await pool.getConnection();
    try {
        const { id } = req.params;

        // ✅ Lấy yêu cầu nạp tiền cần duyệt
        const [deposits] = await connection.query(
            'SELECT * FROM deposit_requests WHERE id = ? AND status = "pending"',
            [id]
        ) as [RowDataPacket[], any];

        if (deposits.length === 0) {
            res.status(404).json({ error: 'Không tìm thấy yêu cầu hoặc đã được xử lý' });
            connection.release();
            return;
        }

        const deposit = deposits[0];

        // ✅ Bắt đầu transaction
        await connection.beginTransaction();

        try {
            // Cập nhật trạng thái yêu cầu
            await connection.query(
                'UPDATE deposit_requests SET status = "approved" WHERE id = ?',
                [id]
            );

            // Tạo ví nếu chưa có
            await connection.query(
                'INSERT IGNORE INTO wallets (user_id, balance) VALUES (?, 0)',
                [deposit.user_id]
            );

            // Cộng tiền vào ví user
            await connection.query(
                'UPDATE wallets SET balance = balance + ? WHERE user_id = ?',
                [deposit.amount, deposit.user_id]
            );

            //  Commit nếu mọi thứ ok
            await connection.commit();
            console.log(` Duyệt nạp tiền: user_id=${deposit.user_id}, +${deposit.amount}`);

            res.json({
                success: true,
                message: `Đã duyệt yêu cầu nạp tiền cho user_id=${deposit.user_id}`,
            });
        } catch (err) {

            await connection.rollback();
            console.error(' Lỗi trong transaction duyệt nạp:', err);
            res.status(500).json({ error: 'Lỗi khi xử lý duyệt nạp tiền' });
        } finally {
            connection.release();
        }
    } catch (error) {
        console.error(' Lỗi duyệt yêu cầu:', error);
        res.status(500).json({ error: 'Lỗi server khi duyệt yêu cầu nạp tiền' });
        connection.release();
    }
});

/*--------------------------------------------------
  Từ chối yêu cầu nạp tiền
--------------------------------------------------*/
router.put('/deposits/:id/reject', adminAuth, async (req: Request, res: Response) => {
    try {
        const { id } = req.params;

        const [result] = await pool.query(
            'UPDATE deposit_requests SET status = "rejected" WHERE id = ? AND status = "pending"',
            [id]
        );

        res.json({ success: true, message: 'Đã từ chối yêu cầu nạp tiền' });
    } catch (error) {
        console.error('Lỗi từ chối yêu cầu:', error);
        res.status(500).json({ error: 'Lỗi server khi từ chối yêu cầu' });
    }
});

/*--------------------------------------------------
  Quản lý người dùng
--------------------------------------------------*/
router.get('/users', adminAuth, getAllUsers);
router.get('/users/:id', adminAuth, getUserById);
router.post('/users', adminAuth, createUser);
router.put('/users/:id', adminAuth, updateUser);
router.delete('/users/:id', adminAuth, deleteUser);

export default router;
